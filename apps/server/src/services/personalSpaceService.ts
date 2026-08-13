import type { Kysely } from 'kysely';
import type { Database } from '../database/schema.js';
import { ChatGptApi, ChatGptApiError } from '../chatgptApi.js';
import { AccountOperationalRepository } from '../repositories/accountOperationalRepository.js';
import { BillingRepository } from '../repositories/billingRepository.js';
import { ActivityLogRepository } from '../repositories/activityLogRepository.js';
import { SessionRepository } from '../repositories/sessionRepository.js';
import { ServiceError } from '../serviceError.js';
import type { Transport } from '../transport.js';

export class PersonalSpaceService {
  readonly #billing: BillingRepository;
  constructor(
    private readonly db: Kysely<Database>, private readonly sessions: SessionRepository,
    private readonly operational: AccountOperationalRepository, private readonly transport: Transport
  ) { this.#billing = new BillingRepository(db); }

  async refresh(accountId: string, resources: string[] = ['subscription', 'billing', 'quota', 'settings']) {
    const { api, personalSpaceId } = await this.context(accountId);
    const observedAt = new Date();
    if (resources.includes('subscription')) {
      const payload = await api.getPersonalSubscription(); const rawPlan = payload.plan_type ?? 'unknown';
      await this.db.insertInto('personal_subscription_snapshots').values({
        personal_space_id: personalSpaceId, normalized_plan: normalizePlan(rawPlan), raw_plan_code: rawPlan,
        status: payload.is_delinquent ? 'delinquent' : 'active', will_renew: payload.will_renew ?? null,
        effective_at: payload.active_start ?? null, ends_at: payload.active_until ?? null,
        payload, observed_at: observedAt
      }).execute();
    }
    if (resources.includes('billing')) {
      const payload = await api.getPersonalBillingSnapshotRaw();
      await this.#billing.saveSnapshot({ kind: 'personal', personalSpaceId }, payload, observedAt);
    }
    if (resources.includes('quota')) {
      const payload = await api.getRateLimitResetCredits();
      await this.db.insertInto('personal_quota_snapshots').values({ personal_space_id: personalSpaceId, payload, observed_at: observedAt }).execute();
    }
    if (resources.includes('settings')) {
      const me = await api.getMe(); const remoteUserId = typeof me.id === 'string' ? me.id : undefined;
      const [profile, notifications] = await Promise.all([
        remoteUserId ? captureUpstream(() => api.getPersonalProfile(remoteUserId)) : Promise.resolve(undefined),
        captureUpstream(() => api.getNotificationSettings())
      ]);
      const payload = {
        me,
        ...(profile !== undefined ? { profile } : {}),
        notifications,
        memory: { readable: false, reason: '上游仅验证了 PATCH 写入协议；GET 实测返回 405' }
      };
      await this.db.insertInto('personal_setting_snapshots').values({ personal_space_id: personalSpaceId, payload, observed_at: observedAt }).execute();
    }
    await this.activity(accountId, 'personal_space_refresh', { resources });
    return this.view(accountId);
  }

  async view(accountId: string) {
    const personal = await this.personal(accountId);
    const [subscription, quota, settings, billing] = await Promise.all([
      this.db.selectFrom('personal_subscription_snapshots').selectAll().where('personal_space_id', '=', personal.id).orderBy('observed_at', 'desc').executeTakeFirst(),
      this.db.selectFrom('personal_quota_snapshots').selectAll().where('personal_space_id', '=', personal.id).orderBy('observed_at', 'desc').executeTakeFirst(),
      this.db.selectFrom('personal_setting_snapshots').selectAll().where('personal_space_id', '=', personal.id).orderBy('observed_at', 'desc').executeTakeFirst(),
      this.#billing.detail({ kind: 'personal', personalSpaceId: personal.id })
    ]);
    return { subscription: subscription ? snapshot(subscription) : undefined, billing, quota: quota ? snapshot(quota) : undefined, settings: settings ? snapshot(settings) : undefined };
  }
  async billing(accountId: string) { const p = await this.personal(accountId); return this.#billing.detail({ kind: 'personal', personalSpaceId: p.id }); }
  async quota(accountId: string) { const p = await this.personal(accountId); const v = await this.db.selectFrom('personal_quota_snapshots').selectAll().where('personal_space_id', '=', p.id).orderBy('observed_at', 'desc').executeTakeFirst(); return v ? snapshot(v) : undefined; }
  async settings(accountId: string) { const p = await this.personal(accountId); const v = await this.db.selectFrom('personal_setting_snapshots').selectAll().where('personal_space_id', '=', p.id).orderBy('observed_at', 'desc').executeTakeFirst(); return v ? snapshot(v) : undefined; }
  async activities(accountId: string, limit = 200) { return new ActivityLogRepository(this.db).list({ accountId, limit }); }
  async patchSettings(accountId: string, input: Record<string, unknown>) {
    const { api } = await this.context(accountId); const me = await api.getMe();
    const remoteUserId = typeof me.id === 'string' ? me.id : undefined;
    if ((typeof input.username === 'string' || typeof input.displayName === 'string') && !remoteUserId) throw new ServiceError(409, '上游未返回用户 ID');
    if (typeof input.username === 'string') await api.setPersonalUsername(remoteUserId!, input.username);
    if (typeof input.displayName === 'string') await api.setPersonalDisplayName(remoteUserId!, input.displayName);
    if (typeof input.marketingPush === 'boolean' || typeof input.marketingEmail === 'boolean') await api.setMarketingNotifications({
      ...(typeof input.marketingPush === 'boolean' ? { push: input.marketingPush } : {}),
      ...(typeof input.marketingEmail === 'boolean' ? { email: input.marketingEmail } : {})
    });
    if (typeof input.memoryEnabled === 'boolean') await api.setMemoryEnabled(input.memoryEnabled);
    return this.refresh(accountId, ['settings']);
  }

  private async context(accountId: string) {
    const personal = await this.personal(accountId); const session = await this.sessions.currentSession(accountId);
    const token = await this.sessions.accessToken(accountId, { kind: 'personal', personalSpaceId: personal.id });
    if (!token) throw new ServiceError(409, '账号缺少个人 Access Token');
    const accountIdHeader = personal.remote_account_id ?? (session as any)?.account?.id;
    if (!accountIdHeader) throw new ServiceError(409, '个人空间缺少远端账号 ID');
    return { personalSpaceId: personal.id, api: new ChatGptApi({ accountId: accountIdHeader, accessToken: token, proxy: await this.operational.proxy(accountId) }, this.transport) };
  }
  private async personal(accountId: string) { const row = await this.db.selectFrom('personal_spaces').selectAll().where('account_id', '=', accountId).executeTakeFirst(); if (!row) throw new ServiceError(404, '账号不存在'); return row; }
  private activity(accountId: string, kind: string, payload: Record<string, unknown>) { return this.db.insertInto('account_activity_logs').values({ account_id: accountId, workspace_id: null, kind, payload, source_file_sha256: null, source_line: null, source_bytes_sha256: null, occurred_at: new Date() }).execute(); }
}
function snapshot(row: { normalized_plan?: string; raw_plan_code?: string | null; status?: string; will_renew?: boolean | null; effective_at?: unknown; ends_at?: unknown; payload: Record<string, unknown>; observed_at: unknown }) {
  if (row.normalized_plan !== undefined) return { plan: normalizePlan(row.normalized_plan), ...(row.raw_plan_code?{rawPlanCode:row.raw_plan_code}:{}),
    status: row.status ?? 'unknown', ...(row.will_renew===null||row.will_renew===undefined?{}:{willRenew:row.will_renew}),
    ...(row.effective_at?{effectiveAt:new Date(row.effective_at as any).toISOString()}:{}),...(row.ends_at?{endsAt:new Date(row.ends_at as any).toISOString()}:{}),
    observedAt:new Date(row.observed_at as any).toISOString() };
  return { payload: row.payload, observedAt: new Date(row.observed_at as any).toISOString() };
}
function normalizePlan(value: string): 'free' | 'go' | 'plus' | 'pro_5x' | 'pro_20x' | 'unknown' { const key = value.toLowerCase(); if (key.includes('prolite')) return 'pro_5x'; if (key.includes('pro')) return 'pro_20x'; if (key.includes('plus')) return 'plus'; if (key.includes('go')) return 'go'; if (key.includes('free')) return 'free'; return 'unknown'; }
async function captureUpstream<T extends Record<string, unknown>>(action: () => Promise<T>): Promise<T | { error: Record<string, unknown> }> {
  try { return await action(); }
  catch (error) {
    if (error instanceof ChatGptApiError) {
      return { error: { name: error.name, message: error.message, status: error.status, context: error.context, body: error.body } };
    }
    const value = error as Error;
    return { error: { name: value?.name ?? 'Error', message: value?.message ?? String(error), stack: value?.stack } };
  }
}
