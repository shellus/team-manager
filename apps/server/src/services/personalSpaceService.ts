import type { Kysely } from 'kysely';
import type { Database } from '../database/schema.js';
import { ChatGptApi, ChatGptApiError } from '../chatgptApi.js';
import { AccountOperationalRepository } from '../repositories/accountOperationalRepository.js';
import { BillingRepository } from '../repositories/billingRepository.js';
import { ActivityLogRepository } from '../repositories/activityLogRepository.js';
import { SessionRepository } from '../repositories/sessionRepository.js';
import { ServiceError } from '../serviceError.js';
import type { Transport } from '../transport.js';
import { normalizePersonalPlan, resolvePersonalPlan } from '../domain/personalPlan.js';
import { fetchChatGptWebAccessTokenFromSessionToken } from '../chatgptWebSession.js';
import type { AccountManagerService } from './accountManagerService.js';

export class PersonalSpaceService {
  readonly #billing: BillingRepository;
  constructor(
    private readonly db: Kysely<Database>, private readonly sessions: SessionRepository,
    private readonly operational: AccountOperationalRepository, private readonly transport: Transport,
    private readonly accountManagement?: AccountManagerService
  ) { this.#billing = new BillingRepository(db); }

  async refresh(accountId: string, resources: string[] = ['subscription', 'billing', 'quota', 'settings']) {
    const context = await this.context(accountId);
    const { personalSpaceId } = context;
    let api = context.api;
    const observedAt = new Date();
    if (resources.includes('subscription')) {
      const accountObservation = await api.checkAccounts();
      const observedPersonal = resolvePersonalPlan(accountObservation, context.accountIdHeader);
      if (observedPersonal.accountId) {
        api = context.apiForAccount(observedPersonal.accountId);
        if (observedPersonal.accountId !== context.storedRemoteAccountId) {
          await this.db.updateTable('personal_spaces').set({ remote_account_id: observedPersonal.accountId })
            .where('id', '=', personalSpaceId).execute();
        }
      }
      const payload = await api.getPersonalSubscription();
      const currentPlan = resolvePersonalPlan(accountObservation, context.accountIdHeader, payload.plan_type);
      await this.db.insertInto('personal_subscription_snapshots').values({
        personal_space_id: personalSpaceId, normalized_plan: currentPlan.normalizedPlan, raw_plan_code: currentPlan.rawPlanCode,
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

  async cancelRenewal(accountId: string) {
    const { api } = await this.context(accountId);
    const before = await api.getPersonalSubscription();
    const plan = normalizePersonalPlan(before.plan_type);
    if (plan === 'free' || plan === 'unknown') {
      throw new ServiceError(409, '该个人空间当前没有可取消续费的付费套餐');
    }
    if (typeof before.will_renew !== 'boolean') throw new ServiceError(502, 'ChatGPT 个人订阅响应缺少续费状态');
    if (before.will_renew !== false) {
      await api.cancelSubscriptionRenewal();
      const after = await waitForRenewalCancellation(() => api.getPersonalSubscription());
      if (after.will_renew !== false) throw new ServiceError(502, 'ChatGPT 已接受取消请求，但尚未确认停止续费');
    }
    await this.activity(accountId, 'personal_subscription_renewal_cancelled', {
      idempotent: before.will_renew === false,
      plan,
      activeUntil: before.active_until ?? null
    });
    return this.refresh(accountId, ['subscription']);
  }

  private async context(accountId: string) {
    const personal = await this.personal(accountId); const session = await this.sessions.currentSession(accountId) as { sessionToken?: string; account?: { id?: string } } | undefined;
    let token = await this.sessions.accessToken(accountId, { kind: 'personal', personalSpaceId: personal.id });
    const accountIdHeader = personal.remote_account_id ?? (session as any)?.account?.id;
    if (!accountIdHeader) throw new ServiceError(409, '个人空间缺少远端账号 ID');
    let proxy = await this.operational.proxy(accountId);
    if (!proxy) proxy = await this.accountManagement?.ensureHttpProxy(accountId).catch(() => undefined);
    const refresh = async (remoteAccountId: string) => {
      if (!session?.sessionToken) throw new ServiceError(409, '执行账号缺少可刷新 Access Token 的 sessionToken');
      const refreshed = await fetchChatGptWebAccessTokenFromSessionToken(
        this.transport, session.sessionToken, remoteAccountId, proxy
      );
      await this.sessions.saveAccessToken(accountId, { kind: 'personal', personalSpaceId: personal.id }, refreshed, { status: 'valid', checkedAt: new Date() });
      return refreshed;
    };
    if (!token) token = await refresh(accountIdHeader);
    const apiForAccount = (remoteAccountId: string) => new ChatGptApi({
      accountId: remoteAccountId,
      accessToken: token!,
      proxy,
      refreshWebAccessToken: () => refresh(remoteAccountId)
    }, this.transport);
    return {
      personalSpaceId: personal.id,
      storedRemoteAccountId: personal.remote_account_id,
      accountIdHeader,
      api: apiForAccount(accountIdHeader),
      apiForAccount
    };
  }
  private async personal(accountId: string) { const row = await this.db.selectFrom('personal_spaces').selectAll().where('account_id', '=', accountId).executeTakeFirst(); if (!row) throw new ServiceError(404, '账号不存在'); return row; }
  private activity(accountId: string, kind: string, payload: Record<string, unknown>) { return this.db.insertInto('account_activity_logs').values({ account_id: accountId, workspace_id: null, kind, payload, source_file_sha256: null, source_line: null, source_bytes_sha256: null, occurred_at: new Date() }).execute(); }
}

async function waitForRenewalCancellation(
  read: () => Promise<{ will_renew?: boolean }>
): Promise<{ will_renew?: boolean }> {
  let value = await read();
  for (let attempt = 1; attempt < 5 && value.will_renew !== false; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    value = await read();
  }
  return value;
}
function snapshot(row: { normalized_plan?: string; raw_plan_code?: string | null; status?: string; will_renew?: boolean | null; effective_at?: unknown; ends_at?: unknown; payload: Record<string, unknown>; observed_at: unknown }) {
  if (row.normalized_plan !== undefined) return { plan: normalizePersonalPlan(row.normalized_plan), ...(row.raw_plan_code?{rawPlanCode:row.raw_plan_code}:{}),
    status: row.status ?? 'unknown', ...(row.will_renew===null||row.will_renew===undefined?{}:{willRenew:row.will_renew}),
    ...(row.effective_at?{effectiveAt:new Date(row.effective_at as any).toISOString()}:{}),...(row.ends_at?{endsAt:new Date(row.ends_at as any).toISOString()}:{}),
    observedAt:new Date(row.observed_at as any).toISOString() };
  return { payload: row.payload, observedAt: new Date(row.observed_at as any).toISOString() };
}
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
