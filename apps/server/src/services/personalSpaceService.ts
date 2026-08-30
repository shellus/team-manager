import type { Kysely } from 'kysely';
import type { PersonalPlan, PersonalSubscriptionChangePreviewView, PromotionLookupView } from '@team-manager/shared';
import type { Database } from '../database/schema.js';
import { ChatGptApi, ChatGptApiError } from '../chatgptApi.js';
import { AccountOperationalRepository } from '../repositories/accountOperationalRepository.js';
import { BillingRepository } from '../repositories/billingRepository.js';
import { ActivityLogRepository } from '../repositories/activityLogRepository.js';
import { SessionRepository } from '../repositories/sessionRepository.js';
import { ServiceError } from '../serviceError.js';
import type { Transport } from '../transport.js';
import {
  isVerifiedPersonalPlanUpgrade,
  normalizePersonalPlan,
  personalPlanCode,
  resolvePersonalPlan
} from '../domain/personalPlan.js';
import { fetchChatGptWebAccessTokenFromSessionToken } from '../chatgptWebSession.js';
import { promotionLookupView } from '../domain/promotion.js';
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
      const subscriptionObservation = await api.getPersonalSubscriptionObservation();
      const payload = subscriptionObservation.subscription;
      const currentPlan = subscriptionObservation.missing
        ? resolvePersonalPlan([], context.accountIdHeader, 'free')
        : resolvePersonalPlan(accountObservation, context.accountIdHeader, payload.plan_type);
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
    } else if (resources.includes('billingDetails') || resources.includes('paymentMethods')) {
      const [billingDetails, paymentMethods] = await Promise.all([
        resources.includes('billingDetails') ? api.getPersonalBillingDetailsRaw() : Promise.resolve(undefined),
        resources.includes('paymentMethods') ? api.getPersonalPaymentMethodsRaw() : Promise.resolve(undefined)
      ]);
      await this.#billing.saveMergedSnapshot({ kind: 'personal', personalSpaceId }, {
        ...billingDetails,
        ...(paymentMethods === undefined ? {} : { paymentMethods })
      }, observedAt);
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
  async checkoutSession(accountId: string) {
    const account = await this.db.selectFrom('accounts').select(['id', 'email'])
      .where('id', '=', accountId).executeTakeFirst();
    if (!account) throw new ServiceError(404, '账号不存在');
    const context = await this.context(accountId);
    return {
      email: account.email,
      accountId: context.accountIdHeader,
      accessToken: context.accessToken,
      ...(context.sessionToken ? { sessionToken: context.sessionToken } : {})
    };
  }

  async lookupPromotion(accountId: string, promoCode: string): Promise<PromotionLookupView> {
    const normalized = promoCode.trim();
    if (!normalized) throw new ServiceError(400, '请输入优惠码');
    if (normalized.length > 256) throw new ServiceError(400, '优惠码长度不能超过 256 个字符');
    const { api } = await this.context(accountId);
    const eligibility = await api.getPromotionEligibility(normalized);
    if (eligibility.is_eligible !== true) {
      return promotionLookupView({ kind: 'personal' }, '个人空间', normalized, eligibility);
    }
    const [metadata, subscription] = await Promise.all([
      api.getPromotionMetadata(normalized),
      api.getPersonalSubscription()
    ]);
    return promotionLookupView({ kind: 'personal' }, '个人空间', normalized, eligibility, metadata, subscription);
  }
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

  async previewSubscriptionChange(
    accountId: string,
    targetPlan: Exclude<PersonalPlan, 'free' | 'unknown'>
  ): Promise<PersonalSubscriptionChangePreviewView> {
    const { api } = await this.context(accountId);
    return this.readSubscriptionChangePreview(api, targetPlan);
  }

  async upgradeSubscription(
    accountId: string,
    targetPlan: Exclude<PersonalPlan, 'free' | 'unknown'>
  ) {
    const { api } = await this.context(accountId);
    const preview = await this.readSubscriptionChangePreview(api, targetPlan);
    await api.updatePersonalSubscription(personalPlanCode(targetPlan));
    const after = await waitForPersonalPlan(() => api.getPersonalSubscription(), targetPlan);
    if (normalizePersonalPlan(after.plan_type) !== targetPlan) {
      throw new ServiceError(502, 'ChatGPT 已接受套餐升级请求，但回读尚未确认目标套餐');
    }
    await this.activity(accountId, 'personal_subscription_upgraded', {
      fromPlan: preview.currentPlan,
      targetPlan,
      amountDueMinor: preview.amountDueMinor,
      currency: preview.currency
    });
    return { detail: await this.refresh(accountId, ['subscription', 'billing']), preview };
  }

  private async readSubscriptionChangePreview(
    api: ChatGptApi,
    targetPlan: Exclude<PersonalPlan, 'free' | 'unknown'>
  ): Promise<PersonalSubscriptionChangePreviewView> {
    const before = await api.getPersonalSubscription();
    const currentPlan = normalizePersonalPlan(before.plan_type);
    if (!isVerifiedPersonalPlanUpgrade(currentPlan, targetPlan)) {
      throw new ServiceError(409, `尚未验证 ${currentPlan} 到 ${targetPlan} 的个人套餐变更协议`);
    }
    const raw = await api.previewPersonalSubscriptionUpdate(personalPlanCode(targetPlan));
    const amountDueMinor = requiredMoney(raw.total_amount, 'total_amount');
    const positiveLineItemMinor = requiredMoney(raw.positive_line_item_total, 'positive_line_item_total');
    const adjustmentMinor = requiredMoney(raw.negative_line_item_total, 'negative_line_item_total');
    const currency = typeof raw.currency === 'string' ? raw.currency.trim().toUpperCase() : '';
    if (!/^[A-Z]{3}$/.test(currency)) throw new ServiceError(502, 'ChatGPT 套餐升级预览缺少有效货币');
    const brand = raw.default_payment_method?.card_brand?.trim();
    const last4 = raw.default_payment_method?.card_last4?.trim();
    return {
      currentPlan,
      targetPlan,
      amountDueMinor,
      positiveLineItemMinor,
      adjustmentMinor,
      currency,
      ...(typeof raw.renewal_date === 'string' && raw.renewal_date.trim()
        ? { renewalDate: raw.renewal_date }
        : {}),
      ...(brand && last4 ? { defaultPaymentMethod: { brand, last4 } } : {})
    };
  }

  private async context(accountId: string) {
    const personal = await this.personal(accountId); const session = await this.sessions.currentSession(accountId) as { sessionToken?: string; accessToken?: string; account?: { id?: string } } | undefined;
    const currentSessionAccountId = session?.account?.id?.trim();
    let accountIdHeader = personal.remote_account_id ?? currentSessionAccountId;
    if (!accountIdHeader) throw new ServiceError(409, '账号缺少可用的个人态 ChatGPT Session');
    let token = await this.sessions.accessToken(accountId, { kind: 'personal', personalSpaceId: personal.id })
      ?? (currentSessionAccountId === accountIdHeader ? session?.accessToken?.trim() : undefined);
    let proxy = await this.operational.proxy(accountId);
    if (!proxy) proxy = await this.accountManagement?.ensureHttpProxy(accountId).catch(() => undefined);
    const fetchFreshWebAccessToken = async (remoteAccountId: string) => {
      if (!session?.sessionToken) throw new ServiceError(409, '执行账号缺少可刷新 Access Token 的 sessionToken');
      return fetchChatGptWebAccessTokenFromSessionToken(
        this.transport, session.sessionToken, remoteAccountId, proxy
      );
    };
    const refresh = async (remoteAccountId: string) => {
      const refreshed = await fetchFreshWebAccessToken(remoteAccountId);
      await this.sessions.saveAccessToken(accountId, { kind: 'personal', personalSpaceId: personal.id }, refreshed, { status: 'valid', checkedAt: new Date() });
      return refreshed;
    };
    if (!personal.remote_account_id && currentSessionAccountId) {
      if (!token) token = await fetchFreshWebAccessToken(currentSessionAccountId);
      const observedAccounts = await new ChatGptApi({
        accountId: currentSessionAccountId,
        accessToken: token ?? '',
        proxy,
        refreshWebAccessToken: async () => {
          const refreshed = await fetchFreshWebAccessToken(currentSessionAccountId);
          token = refreshed;
          return refreshed;
        }
      }, this.transport).checkAccounts();
      const observedPersonal = resolvePersonalPlan(observedAccounts, currentSessionAccountId);
      if (!observedPersonal.accountId) throw new ServiceError(409, '账号缺少可用的个人态 ChatGPT Session');
      accountIdHeader = observedPersonal.accountId;
      await this.db.updateTable('personal_spaces').set({ remote_account_id: accountIdHeader })
        .where('id', '=', personal.id).executeTakeFirstOrThrow();
      if (token) {
        await this.sessions.saveAccessToken(accountId, { kind: 'personal', personalSpaceId: personal.id }, token, { status: 'unknown' });
      }
    }
    if (!token) token = await refresh(accountIdHeader);
    const apiForAccount = (remoteAccountId: string) => new ChatGptApi({
      accountId: remoteAccountId,
      accessToken: token!,
      proxy,
      refreshWebAccessToken: () => refresh(remoteAccountId)
    }, this.transport);
    return {
      personalSpaceId: personal.id,
      storedRemoteAccountId: accountIdHeader,
      accountIdHeader,
      accessToken: token!,
      sessionToken: session?.sessionToken,
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

async function waitForPersonalPlan(
  read: () => Promise<{ plan_type?: string }>,
  targetPlan: PersonalPlan
): Promise<{ plan_type?: string }> {
  let value = await read();
  for (let attempt = 1; attempt < 6 && normalizePersonalPlan(value.plan_type) !== targetPlan; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    value = await read();
  }
  return value;
}

function requiredMoney(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new ServiceError(502, `ChatGPT 套餐升级预览缺少有效 ${field}`);
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
      return { error: { name: error.name, message: error.message, upstreamStatus: error.status, context: error.context, body: error.body } };
    }
    const value = error as Error;
    return { error: { name: value?.name ?? 'Error', message: value?.message ?? String(error), stack: value?.stack } };
  }
}
