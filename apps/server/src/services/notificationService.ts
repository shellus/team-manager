import type { Kysely } from 'kysely';
import type { Database } from '../database/schema.js';
import { ServiceError, upstreamHttpError } from '../serviceError.js';
import { fetchWithRawTrace } from '../transport.js';
import { LIMITED_MAX_ATTEMPTS, limitedRetryDelay } from '../retryPolicy.js';
import { addCalendarDays, calendarDateInTimeZone } from '../domain/businessDate.js';
import {
  notificationTestMessage, seatExpiryMessage, seatRemovalFailureMessage, workspaceRenewalMessage,
  type NotificationMessageContext, type SeatExpiryNotificationItem, type WorkspaceRenewalNotificationItem
} from '../domain/notificationMessage.js';

type NotificationChannel = 'webhook'|'feishu'|'wecom'|'telegram';
type NotificationPayload = Record<string, unknown> & { type?: string; text?: string; summaryText?: string };
type PolicyRow = { id: string; kind: string; configuration: Record<string, unknown> };

export class NotificationService {
  constructor(private readonly db: Kysely<Database>, private readonly fetchImpl?: typeof fetch) {}

  async deliveries(limit = 200) {
    const rows = await this.db.selectFrom('notification_deliveries as d')
      .innerJoin('notification_policies as p', 'p.id', 'd.policy_id')
      .selectAll('d').select(['p.kind', 'p.configuration as current_configuration']).orderBy('d.created_at', 'desc')
      .limit(Math.min(Math.max(limit, 1), 1000)).execute();
    return rows.map((row) => {
      const config = snapshotOrCurrent(row.configuration_snapshot, row.current_configuration);
      const channels = configuredNotificationChannels(config);
      const deliveredChannels = notificationChannels(row.delivered_channels).filter((channel) => channels.includes(channel));
      return {
        id: row.id, kind: row.kind, status: row.status, summaryText: deliverySummary(row.safe_summary),
        attemptCount: row.attempt_count, maxAttempts: row.max_attempts, channels, deliveredChannels,
        pendingChannels: channels.filter((channel) => !deliveredChannels.includes(channel)),
        ...(row.error_message ? { error: row.error_message } : {}),
        ...(row.next_retry_at ? { nextRetryAt: new Date(row.next_retry_at as Date).toISOString() } : {}),
        ...(row.delivered_at ? { deliveredAt: new Date(row.delivered_at as Date).toISOString() } : {}),
        createdAt: new Date(row.created_at as unknown as Date).toISOString()
      };
    });
  }

  async test(kind: string) {
    const policy = await this.policy(kind);
    const context = messageContext(policy.configuration, new Date().toISOString());
    const today = calendarDateInTimeZone(new Date(context.observedAt), context.timeZone);
    context.windowStart = today;
    context.windowEnd = addCalendarDays(today, numberValue(policy.configuration.advanceDays, 7));
    const message = notificationTestMessage(kind, context);
    return this.enqueue(policy, { type: 'test', ...message, at: context.observedAt, context }, true);
  }

  async send(kind: string, payload: NotificationPayload, throwOnFailure = true) {
    return this.enqueue(await this.policy(kind), payload, throwOnFailure);
  }

  async retry(id: string) {
    const delivery = await this.db.selectFrom('notification_deliveries').selectAll().where('id', '=', id).executeTakeFirst();
    if (!delivery) throw new ServiceError(404, '投递不存在');
    if (delivery.status === 'delivered') throw new ServiceError(409, '通知已经投递成功');
    if (delivery.status === 'sending') throw new ServiceError(409, '通知正在投递');
    if (delivery.attempt_count >= delivery.max_attempts) throw new ServiceError(409, '通知已达到最大重试次数');
    await this.db.updateTable('notification_deliveries').set({ status: 'retrying', next_retry_at: new Date() }).where('id', '=', id).execute();
    return this.attempt(id, true);
  }

  async notifySeatExpiry(items: SeatExpiryNotificationItem[], kind?: string, inputContext?: Partial<NotificationMessageContext>) {
    let query = this.db.selectFrom('notification_policies').select(['id', 'kind', 'configuration']).where('enabled', '=', true);
    query = query.where('kind', '=', kind || 'seat_expiration');
    const policies = await query.execute();
    for (const policy of policies) {
      const context = { ...messageContext(policy.configuration, inputContext?.observedAt), ...inputContext } as NotificationMessageContext;
      const previousItems = await this.previousSeatExpiryItems(policy.id);
      const message = seatExpiryMessage(items, context, previousItems);
      await this.enqueue(policy, { type: 'seat_expiration', ...message, items, context }, false);
    }
    return { policies: policies.length, items: items.length };
  }

  async notifyWorkspaceRenewal(items: WorkspaceRenewalNotificationItem[], kind = 'workspace_renewal', inputContext?: Partial<NotificationMessageContext>) {
    const policy = await this.policy(kind);
    const context = { ...messageContext(policy.configuration, inputContext?.observedAt), ...inputContext } as NotificationMessageContext;
    const message = workspaceRenewalMessage(items, context);
    await this.enqueue(policy, { type: 'workspace_renewal', ...message, items, context }, false);
    return { items: items.length };
  }

  async notifySeatRemovalFailure(item: Record<string, unknown>) {
    const policy = await this.policy('seat_expiration');
    const context = messageContext(policy.configuration);
    const message = seatRemovalFailureMessage({
      seatSlotId: text(item.seatSlotId), email: text(item.email), workspaceId: text(item.workspaceId),
      workspaceName: text(item.workspaceName), workspaceExternalId: text(item.workspaceExternalId), expiresOn: text(item.expiresOn),
      attemptCount: optionalNumber(item.attemptCount), maxAttempts: optionalNumber(item.maxAttempts), error: text(item.error)
    }, context);
    return this.enqueue(policy, { type: 'seat_expiration_removal_failed', ...message, item, context }, false);
  }

  async retryFailed(limit = 20) {
    const now = new Date();
    await this.db.updateTable('notification_deliveries').set({ status: 'retrying', next_retry_at: now })
      .where('status', '=', 'sending').where('last_attempt_at', '<=', new Date(now.getTime() - 15 * 60_000)).execute();
    const rows = await this.db.selectFrom('notification_deliveries').select('id')
      .where('status', '=', 'retrying').whereRef('attempt_count', '<', 'max_attempts')
      .where('next_retry_at', '<=', now).orderBy('next_retry_at').limit(limit).execute();
    for (const row of rows) await this.attempt(row.id, false).catch(() => undefined);
    return { checked: rows.length };
  }

  private async policy(kind: string): Promise<PolicyRow> {
    const policy = await this.db.selectFrom('notification_policies').select(['id', 'kind', 'configuration']).where('kind', '=', kind).executeTakeFirst();
    if (!policy) throw new ServiceError(404, '通知策略不存在');
    return policy;
  }

  private async enqueue(policy: PolicyRow, payload: NotificationPayload, throwOnFailure: boolean) {
    const delivery = await this.db.insertInto('notification_deliveries').values({
      policy_id: policy.id, status: 'queued',
      safe_summary: { type: payload.type ?? policy.kind, text: payload.summaryText ?? payload.type ?? policy.kind }, payload,
      configuration_snapshot: policy.configuration, delivered_channels: {},
      error_message: null, delivered_at: null, attempt_count: 0, max_attempts: LIMITED_MAX_ATTEMPTS,
      next_retry_at: new Date(), last_attempt_at: null
    }).returning('id').executeTakeFirstOrThrow();
    return this.attempt(delivery.id, throwOnFailure);
  }

  private async previousSeatExpiryItems(policyId: string): Promise<SeatExpiryNotificationItem[]|undefined> {
    const rows = await this.db.selectFrom('notification_deliveries').select('payload')
      .where('policy_id', '=', policyId).where('status', '=', 'delivered').orderBy('created_at', 'desc').limit(20).execute();
    for (const row of rows) {
      if (row.payload.type !== 'seat_expiration' || !Array.isArray(row.payload.items)) continue;
      return row.payload.items.flatMap((value) => seatExpiryItem(value));
    }
    return undefined;
  }

  private async attempt(id: string, throwOnFailure: boolean) {
    const delivery = await this.db.selectFrom('notification_deliveries as d')
      .innerJoin('notification_policies as p', 'p.id', 'd.policy_id')
      .selectAll('d').select('p.configuration as current_configuration').where('d.id', '=', id).executeTakeFirst();
    if (!delivery) throw new ServiceError(404, '投递不存在');
    if (delivery.attempt_count >= delivery.max_attempts) throw new ServiceError(409, '通知已达到最大重试次数');

    const attemptCount = delivery.attempt_count + 1;
    const attemptedAt = new Date();
    const claimed = await this.db.updateTable('notification_deliveries').set({
      status: 'sending', attempt_count: attemptCount, last_attempt_at: attemptedAt, next_retry_at: null
    }).where('id', '=', id).where('attempt_count', '=', delivery.attempt_count)
      .where('status', 'in', ['queued', 'retrying']).returning('id').executeTakeFirst();
    if (!claimed) throw new ServiceError(409, '通知正在由另一个任务投递');
    try {
      const config = snapshotOrCurrent(delivery.configuration_snapshot, delivery.current_configuration);
      let deliveredChannels = notificationChannels(delivery.delivered_channels);
      await sendConfiguration(config, delivery.payload, deliveredChannels, async (channel) => {
        deliveredChannels = [...new Set([...deliveredChannels, channel])];
        await this.db.updateTable('notification_deliveries').set({ delivered_channels: Object.fromEntries(deliveredChannels.map((item) => [item, true])) }).where('id', '=', id).execute();
      }, this.fetchImpl);
      await this.db.updateTable('notification_deliveries').set({
        status: 'delivered', delivered_at: new Date(), error_message: null, next_retry_at: null
      }).where('id', '=', id).execute();
      return { deliveryId: id, status: 'delivered', attemptCount };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const delay = limitedRetryDelay(attemptCount);
      const shouldRetry = delay !== undefined && attemptCount < delivery.max_attempts;
      await this.db.updateTable('notification_deliveries').set({
        status: shouldRetry ? 'retrying' : 'exhausted', error_message: message,
        next_retry_at: shouldRetry ? new Date(attemptedAt.getTime() + delay) : null
      }).where('id', '=', id).execute();
      if (throwOnFailure) throw error instanceof ServiceError ? error : new ServiceError(502, message);
      return { deliveryId: id, status: shouldRetry ? 'retrying' : 'exhausted', attemptCount };
    }
  }
}

export async function sendConfiguration(
  config: Record<string, unknown>, payload: Record<string, unknown>, alreadyDelivered: NotificationChannel[] = [],
  onDelivered: (channel: NotificationChannel) => Promise<void> = async () => undefined, fetchImpl?: typeof fetch
) {
  const requests = notificationRequests(config, payload);
  if (!requests.length) throw new Error('通知策略没有可用渠道');
  for (const item of requests) {
    if (alreadyDelivered.includes(item.channel)) continue;
    const response = await fetchWithRawTrace(item.upstream, item.url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item.body)
    }, fetchImpl);
    if (!response.ok) throw upstreamHttpError(response.status, `${item.upstream} HTTP ${response.status}`);
    await assertApplicationSuccess(item.channel, response);
    await onDelivered(item.channel);
  }
}

export function notificationRequests(config: Record<string, unknown>, payload: Record<string, unknown>) {
  const requests: Array<{ channel: NotificationChannel; upstream: string; url: string; body: unknown }> = [];
  const channels = configuredNotificationChannels(config);
  const bodyText = String(payload.text ?? JSON.stringify(payload));
  if (channels.includes('webhook')) requests.push({ channel: 'webhook', upstream: 'notification-webhook', url: text(config.webhookUrl), body: payload });
  if (channels.includes('feishu')) requests.push({ channel: 'feishu', upstream: 'notification-feishu', url: text(config.feishuWebhookUrl), body: { msg_type: 'text', content: { text: bodyText } } });
  if (channels.includes('wecom')) requests.push({ channel: 'wecom', upstream: 'notification-wecom', url: text(config.wecomWebhookUrl), body: { msgtype: 'text', text: { content: bodyText } } });
  const bot = text(config.telegramBotToken), chat = text(config.telegramChatId);
  if (channels.includes('telegram')) requests.push({ channel: 'telegram', upstream: 'notification-telegram', url: `https://api.telegram.org/bot${bot}/sendMessage`, body: { chat_id: chat, text: bodyText } });
  return requests;
}

export function configuredNotificationChannels(config: Record<string, unknown>): NotificationChannel[] {
  const channels: NotificationChannel[] = [];
  if (channelEnabled(config.webhookEnabled, text(config.webhookUrl))) channels.push('webhook');
  if (channelEnabled(config.feishuEnabled, text(config.feishuWebhookUrl))) channels.push('feishu');
  if (channelEnabled(config.wecomEnabled, text(config.wecomWebhookUrl))) channels.push('wecom');
  if (channelEnabled(config.telegramEnabled, text(config.telegramBotToken) && text(config.telegramChatId))) channels.push('telegram');
  return channels;
}

async function assertApplicationSuccess(channel: NotificationChannel, response: Response) {
  if (channel === 'webhook') return;
  const value = await response.clone().json().catch(() => undefined) as Record<string, unknown>|undefined;
  const success = channel === 'telegram' ? value?.ok === true
    : channel === 'wecom' ? Number(value?.errcode) === 0
      : Number(value?.code ?? value?.StatusCode) === 0;
  if (!success) {
    const code = value?.errcode ?? value?.code ?? value?.StatusCode ?? '响应格式无效';
    const message = text(value?.errmsg ?? value?.msg ?? value?.StatusMessage);
    throw new Error(`${channel} 返回失败：${String(code)}${message ? ` ${message}` : ''}`);
  }
}

function messageContext(config: Record<string, unknown>, observedAt = new Date().toISOString()): NotificationMessageContext {
  return { observedAt, timeZone: text(config.timeZone) || 'Asia/Shanghai', ...(text(config.managementUrl) ? { managementUrl: text(config.managementUrl) } : {}) };
}
function snapshotOrCurrent(snapshot: Record<string, unknown>, current: Record<string, unknown>) { return Object.keys(snapshot).length ? snapshot : current; }
function notificationChannels(value: unknown): NotificationChannel[] {
  const items = Array.isArray(value) ? value : value && typeof value === 'object' ? Object.entries(value).filter(([,enabled])=>enabled===true).map(([channel])=>channel) : [];
  return items.filter((item): item is NotificationChannel => ['webhook','feishu','wecom','telegram'].includes(String(item)));
}
function seatExpiryItem(value: unknown): SeatExpiryNotificationItem[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const item = value as Record<string, unknown>;
  if (!text(item.seatSlotId) || (!text(item.email) && item.relationStatus !== 'unclaimed') || !text(item.expiresOn) || !text(item.workspaceId)) return [];
  return [{ seatSlotId:text(item.seatSlotId), ...(text(item.email)?{email:text(item.email)}:{relationStatus:'unclaimed' as const}), expiresOn:text(item.expiresOn), expireRemove:item.expireRemove===true, workspaceId:text(item.workspaceId),
    ...(text(item.workspaceName)?{workspaceName:text(item.workspaceName)}:{}), ...(text(item.workspaceExternalId)?{workspaceExternalId:text(item.workspaceExternalId)}:{}) }];
}
function numberValue(value: unknown, fallback: number) { const result = Number(value); return Number.isInteger(result) ? result : fallback; }
function optionalNumber(value: unknown) { const result = Number(value); return Number.isFinite(result) ? result : undefined; }
function channelEnabled(value: unknown, configured: unknown) { return (typeof value === 'boolean' ? value : Boolean(configured)) && Boolean(configured); }
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function deliverySummary(value: Record<string, unknown>): string { return text(value.text) || text(value.type) || '通知投递'; }
