import type { Kysely } from 'kysely';
import type { Database } from '../database/schema.js';
import { ServiceError } from '../serviceError.js';
import { fetchWithRawTrace } from '../transport.js';

export class NotificationService {
  constructor(private readonly db: Kysely<Database>, private readonly fetchImpl?: typeof fetch) {}
  deliveries(limit = 200) { return this.db.selectFrom('notification_deliveries as d').innerJoin('notification_policies as p', 'p.id', 'd.policy_id').selectAll('d').select('p.kind').orderBy('d.created_at', 'desc').limit(Math.min(Math.max(limit, 1), 1000)).execute(); }
  test(kind: string) { return this.send(kind, { type: 'test', text: `Team Manager ${kind} 通知测试`, at: new Date().toISOString() }); }
  async send(kind: string, payload: Record<string, unknown>) {
    const policy = await this.db.selectFrom('notification_policies').selectAll().where('kind', '=', kind).executeTakeFirst();
    if (!policy) throw new ServiceError(404, '通知策略不存在');
    const delivery = await this.db.insertInto('notification_deliveries').values({ policy_id: policy.id, status: 'sending', safe_summary: { type: payload.type ?? kind }, error_message: null, delivered_at: null }).returning('id').executeTakeFirstOrThrow();
    try { await sendConfiguration(policy.configuration, payload, this.fetchImpl); await this.db.updateTable('notification_deliveries').set({ status: 'delivered', delivered_at: new Date() }).where('id', '=', delivery.id).execute(); return { deliveryId: delivery.id, status: 'delivered' }; }
    catch (error) { const message = error instanceof Error ? error.message : String(error); await this.db.updateTable('notification_deliveries').set({ status: 'failed', error_message: message }).where('id', '=', delivery.id).execute(); throw new ServiceError(502, message); }
  }
  async retry(id: string) { const delivery = await this.db.selectFrom('notification_deliveries as d').innerJoin('notification_policies as p', 'p.id', 'd.policy_id').select(['p.kind', 'd.safe_summary']).where('d.id', '=', id).executeTakeFirst(); if (!delivery) throw new ServiceError(404, '投递不存在'); return this.send(delivery.kind, { ...delivery.safe_summary, type: 'retry', text: `Team Manager ${delivery.kind} 重试通知` }); }
  async notifySeatExpiry(items: Record<string, unknown>[]) { const policies = await this.db.selectFrom('notification_policies').select('kind').where('enabled', '=', true).execute(); for (const policy of policies) await this.send(policy.kind, { type: 'seat_expiration', text: `客户席位到期提醒：${items.length} 项`, items }).catch(() => undefined); return { policies: policies.length, items: items.length }; }
  async retryFailed(limit = 20) { const rows = await this.db.selectFrom('notification_deliveries').select('id').where('status', '=', 'failed').orderBy('created_at').limit(limit).execute(); for (const row of rows) await this.retry(row.id).catch(() => undefined); return { checked: rows.length }; }
}

async function sendConfiguration(config: Record<string, unknown>, payload: Record<string, unknown>, fetchImpl?: typeof fetch) {
  const requests: Array<{ upstream: string; url: string; body: unknown }> = [];
  if (text(config.webhookUrl)) requests.push({ upstream: 'notification-webhook', url: text(config.webhookUrl), body: payload });
  if (text(config.feishuWebhookUrl)) requests.push({ upstream: 'notification-feishu', url: text(config.feishuWebhookUrl), body: { msg_type: 'text', content: { text: String(payload.text ?? JSON.stringify(payload)) } } });
  if (text(config.wecomWebhookUrl)) requests.push({ upstream: 'notification-wecom', url: text(config.wecomWebhookUrl), body: { msgtype: 'text', text: { content: String(payload.text ?? JSON.stringify(payload)) } } });
  const bot = text(config.telegramBotToken), chat = text(config.telegramChatId);
  if (bot && chat) requests.push({ upstream: 'notification-telegram', url: `https://api.telegram.org/bot${bot}/sendMessage`, body: { chat_id: chat, text: String(payload.text ?? JSON.stringify(payload)) } });
  if (!requests.length) throw new Error('通知策略没有可用渠道');
  for (const item of requests) { const response = await fetchWithRawTrace(item.upstream, item.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item.body) }, fetchImpl); if (!response.ok) throw new Error(`${item.upstream} HTTP ${response.status}`); }
}
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
