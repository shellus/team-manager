import type { Kysely } from 'kysely';
import type { Database } from '../database/schema.js';
import { ServiceError } from '../serviceError.js';
import { fetchWithRawTrace } from '../transport.js';

const RETRY_DELAYS_MS = [60_000, 5 * 60_000] as const;
const DEFAULT_MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

export class NotificationService {
  constructor(private readonly db: Kysely<Database>, private readonly fetchImpl?: typeof fetch) {}

  async deliveries(limit = 200) {
    const rows = await this.db.selectFrom('notification_deliveries as d')
      .innerJoin('notification_policies as p', 'p.id', 'd.policy_id')
      .selectAll('d').select('p.kind').orderBy('d.created_at', 'desc')
      .limit(Math.min(Math.max(limit, 1), 1000)).execute();
    return rows.map((row) => ({
      id: row.id, kind: row.kind, status: row.status, summaryText: deliverySummary(row.safe_summary),
      attemptCount: row.attempt_count, maxAttempts: row.max_attempts,
      ...(row.error_message ? { error: row.error_message } : {}),
      ...(row.next_retry_at ? { nextRetryAt: new Date(row.next_retry_at as any).toISOString() } : {}),
      ...(row.delivered_at ? { deliveredAt: new Date(row.delivered_at as any).toISOString() } : {}),
      createdAt: new Date(row.created_at as any).toISOString()
    }));
  }

  test(kind: string) {
    return this.send(kind, { type: 'test', text: `Team Manager ${kind} 通知测试`, at: new Date().toISOString() });
  }

  async send(kind: string, payload: Record<string, unknown>) {
    const policy = await this.db.selectFrom('notification_policies').selectAll().where('kind', '=', kind).executeTakeFirst();
    if (!policy) throw new ServiceError(404, '通知策略不存在');
    const delivery = await this.db.insertInto('notification_deliveries').values({
      policy_id: policy.id, status: 'queued', safe_summary: { type: payload.type ?? kind }, payload,
      error_message: null, delivered_at: null, attempt_count: 0, max_attempts: DEFAULT_MAX_ATTEMPTS,
      next_retry_at: new Date(), last_attempt_at: null
    }).returning('id').executeTakeFirstOrThrow();
    return this.attempt(delivery.id, true);
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

  async notifySeatExpiry(items: Record<string, unknown>[], kind?: string) {
    let query = this.db.selectFrom('notification_policies').select('kind').where('enabled', '=', true);
    if (kind) query = query.where('kind', '=', kind);
    const policies = await query.execute();
    for (const policy of policies) {
      await this.send(policy.kind, {
        type: 'seat_expiration', text: `客户席位到期提醒：${items.length} 项`, items
      }).catch(() => undefined);
    }
    return { policies: policies.length, items: items.length };
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

  private async attempt(id: string, throwOnFailure: boolean) {
    const delivery = await this.db.selectFrom('notification_deliveries as d')
      .innerJoin('notification_policies as p', 'p.id', 'd.policy_id')
      .selectAll('d').select('p.configuration').where('d.id', '=', id).executeTakeFirst();
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
      await sendConfiguration(delivery.configuration, delivery.payload, this.fetchImpl);
      await this.db.updateTable('notification_deliveries').set({
        status: 'delivered', delivered_at: new Date(), error_message: null, next_retry_at: null
      }).where('id', '=', id).execute();
      return { deliveryId: id, status: 'delivered', attemptCount };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const delay = RETRY_DELAYS_MS[attemptCount - 1];
      const shouldRetry = delay !== undefined && attemptCount < delivery.max_attempts;
      await this.db.updateTable('notification_deliveries').set({
        status: shouldRetry ? 'retrying' : 'exhausted',
        error_message: message,
        next_retry_at: shouldRetry
          ? new Date(attemptedAt.getTime() + delay)
          : null
      }).where('id', '=', id).execute();
      if (throwOnFailure) throw new ServiceError(502, message);
      return { deliveryId: id, status: shouldRetry ? 'retrying' : 'exhausted', attemptCount };
    }
  }
}

async function sendConfiguration(config: Record<string, unknown>, payload: Record<string, unknown>, fetchImpl?: typeof fetch) {
  const requests: Array<{ upstream: string; url: string; body: unknown }> = [];
  if (text(config.webhookUrl)) requests.push({ upstream: 'notification-webhook', url: text(config.webhookUrl), body: payload });
  if (text(config.feishuWebhookUrl)) requests.push({ upstream: 'notification-feishu', url: text(config.feishuWebhookUrl), body: { msg_type: 'text', content: { text: String(payload.text ?? JSON.stringify(payload)) } } });
  if (text(config.wecomWebhookUrl)) requests.push({ upstream: 'notification-wecom', url: text(config.wecomWebhookUrl), body: { msgtype: 'text', text: { content: String(payload.text ?? JSON.stringify(payload)) } } });
  const bot = text(config.telegramBotToken), chat = text(config.telegramChatId);
  if (bot && chat) requests.push({ upstream: 'notification-telegram', url: `https://api.telegram.org/bot${bot}/sendMessage`, body: { chat_id: chat, text: String(payload.text ?? JSON.stringify(payload)) } });
  if (!requests.length) throw new Error('通知策略没有可用渠道');
  for (const item of requests) {
    const response = await fetchWithRawTrace(item.upstream, item.url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item.body)
    }, fetchImpl);
    if (!response.ok) throw new Error(`${item.upstream} HTTP ${response.status}`);
  }
}

function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function deliverySummary(value:Record<string,unknown>):string{return text(value.text)||text(value.type)||'通知投递';}
