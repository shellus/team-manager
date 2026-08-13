import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type {
  AccountManagerStateView,
  AddPersonalPaymentMethodRequest,
  RegisterAccountRequest,
  ResidentialProxyConfig
} from '@team-manager/shared';
import type { Database } from '../database/schema.js';
import type { AccountManagerGateway } from '../accountManagerClient.js';
import { AccountRepository } from '../repositories/accountRepository.js';
import { AutomationOperationRepository } from '../repositories/automationOperationRepository.js';
import { SessionRepository } from '../repositories/sessionRepository.js';
import { ServiceError, asServiceError } from '../serviceError.js';
import { WorkspaceRepository } from '../repositories/workspaceRepository.js';
import type { ManagedAccountSummary } from '../accountManagerClient.js';
import { ActivityLogRepository } from '../repositories/activityLogRepository.js';

export class AccountManagerService {
  readonly #accounts: AccountRepository;
  readonly #operations: AutomationOperationRepository;
  readonly #workspaces: WorkspaceRepository;
  readonly #activity: ActivityLogRepository;

  constructor(
    private readonly db: Kysely<Database>,
    private readonly sessions: SessionRepository,
    private readonly manager?: AccountManagerGateway
  ) {
    this.#accounts = new AccountRepository(db);
    this.#operations = new AutomationOperationRepository(db);
    this.#workspaces = new WorkspaceRepository(db);
    this.#activity = new ActivityLogRepository(db);
  }

  async state(accountId: string): Promise<AccountManagerStateView> {
    const ref = await this.accountRef(accountId);
    const localOperations = await this.#operations.listForAccount(accountId);
    if (!this.manager) return { operations: localOperations };
    const [account, profile, proxy, remoteOperations] = await Promise.all([
      this.manager.account?.(ref).catch(() => undefined),
      this.manager.accountProfile?.(ref).catch(() => undefined),
      this.manager.accountProxyConfig?.(ref).catch(() => undefined),
      this.manager.listAccountOperations?.(ref).catch(() => []) ?? []
    ]);
    if (profile) await this.db.updateTable('account_operational_profiles').set({ profile_status: profile.status, profile_checked_at: new Date() }).where('account_id', '=', accountId).execute();
    return {
      ...(account ? { account: {
        id: account.id,
        email: account.email,
        ...(account.personalPlan ? { personalPlan: account.personalPlan } : {}),
        ...(account.paymentMethods ? { paymentMethods: account.paymentMethods } : {})
      } } : {}),
      ...(profile ? { profile } : {}),
      ...(proxy ? { proxy } : {}),
      operations: mergeOperations(localOperations, remoteOperations)
    };
  }

  async sync(accountId: string): Promise<AccountManagerStateView> {
    const manager = this.require('syncAccount');
    const ref = await this.accountRef(accountId);
    const remote = await manager.syncAccount!(ref);
    await this.persistRemoteState(accountId, remote);
    return this.state(accountId);
  }

  async startProfile(accountId: string) {
    const manager = this.require('startAccountProfile');
    const profile=await manager.startAccountProfile!(await this.accountRef(accountId));await this.db.updateTable('account_operational_profiles').set({profile_status:profile.status,profile_checked_at:new Date()}).where('account_id','=',accountId).execute();return profile;
  }

  async stopProfile(accountId: string) {
    const manager = this.require('stopAccountProfile');
    const profile=await manager.stopAccountProfile!(await this.accountRef(accountId));await this.db.updateTable('account_operational_profiles').set({profile_status:profile.status,profile_checked_at:new Date()}).where('account_id','=',accountId).execute();return profile;
  }

  async setProxy(accountId: string, input: ResidentialProxyConfig) {
    if (!input.sid.trim()) throw new ServiceError(400, '代理 SID 不能为空');
    if (!/^[A-Z]{2}$/i.test(input.country)) throw new ServiceError(400, '代理国家必须是两个字母');
    if (input.asn && (input.state || input.city)) throw new ServiceError(400, 'ASN 与州/城市不能同时设置');
    if (input.city && !input.state) throw new ServiceError(400, '设置城市时必须同时设置州/省');
    const manager = this.require('configureAccountProxy');
    return manager.configureAccountProxy!(await this.accountRef(accountId), { ...input, country: input.country.toUpperCase() });
  }

  async importSession(accountId: string) {
    const manager = this.require('session');
    const session = await manager.session!(await this.accountRef(accountId));
    const account = await this.#accounts.findById(accountId);
    if (!account) throw new ServiceError(404, '账号不存在');
    if (account.normalized_email !== session.user.email.trim().toLowerCase()) {
      throw new ServiceError(409, 'GAM Session 邮箱与账号不一致');
    }
    const personal = await this.db.selectFrom('personal_spaces').select('id').where('account_id', '=', accountId).executeTakeFirstOrThrow();
    await this.sessions.saveRevision({
      accountId,
      session,
      source: 'gam_sync',
      observedEmail: session.user.email,
      observedPersonalAccountId: session.account.id
    });
    await this.sessions.saveAccessToken(accountId, { kind: 'personal', personalSpaceId: personal.id }, session.accessToken);
    return session;
  }

  async addPaymentMethod(accountId: string, input: AddPersonalPaymentMethodRequest) {
    const manager = this.require('addPersonalPaymentMethod');
    const operationId = await this.#operations.start({
      accountId,
      kind: 'add_personal_payment_method',
      idempotencyKey: randomUUID(),
      safeRequestSummary: {
        country: input.country,
        currency: input.currency,
        cardLast4: input.card.number.slice(-4)
      }
    });
    const operation = await manager.addPersonalPaymentMethod!(await this.accountRef(accountId), {
      ...input,
      requestTag: `team-manager:${operationId}`
    });
    await this.#operations.attach(operationId, operation);
    await this.#activity.log({accountId,kind:'personal_payment_method_add_requested',payload:{operationId,country:input.country,currency:input.currency,cardLast4:input.card.number.slice(-4)}});
    return this.#operations.view(operationId);
  }

  async register(input: RegisterAccountRequest) {
    const manager = this.require('startRegistration');
    const group = await this.db.selectFrom('account_groups').select(['id', 'name']).where('id', '=', input.groupId).executeTakeFirst();
    if (!group) throw new ServiceError(404, '目标分组不存在');
    const operationId = await this.#operations.startRegistration({
      targetGroupId: group.id,
      idempotencyKey: randomUUID(),
      safeRequestSummary: {
        ...(input.email ? { email: input.email.trim().toLowerCase() } : {}),
        ...(input.country ? { country: input.country.toUpperCase() } : {}),
        ...(input.mailGroup ? { mailGroup: input.mailGroup } : {}),
        targetGroupId: group.id,
        targetGroupName: group.name
      }
    });
    const operation = await manager.startRegistration!({
      ...(input.email ? { email: input.email } : {}),
      ...(input.country ? { country: input.country } : {}),
      ...(input.mailGroup ? { mailGroup: input.mailGroup } : {}),
      ...(input.resumeExisting !== undefined ? { resumeExisting: input.resumeExisting } : {}),
      requestTag: `team-manager:${operationId}`,
      clientReference: group.id
    });
    await this.#operations.attach(operationId, operation);
    await this.#activity.log({kind:'account_registration_requested',payload:{operationId,targetGroupId:group.id,email:input.email?.trim().toLowerCase()??null}});
    return this.#operations.view(operationId);
  }

  async registration(operationId: string) {
    const local = await this.db.selectFrom('automation_operations').selectAll().where('id', '=', operationId)
      .where('kind', '=', 'register_account').executeTakeFirst();
    if (!local?.external_operation_id) throw new ServiceError(404, '注册操作不存在');
    const manager = this.require('operation');
    const operation = await manager.operation!(local.external_operation_id);
    let accountId = local.account_id ?? undefined;
    if (operation.status === 'succeeded' && !accountId) {
      const email = operation.email?.trim().toLowerCase() || stringFrom(operation.result, 'email') || operation.accountId?.trim().toLowerCase();
      if (!email) throw new ServiceError(502, 'GAM 注册成功但未返回邮箱');
      const existing = await this.#accounts.findByEmail(email);
      if (existing) accountId = existing.id;
      else {
        if (!local.target_group_id) throw new ServiceError(500, '注册操作缺少目标分组');
        accountId = (await this.#accounts.create({ email, groupId: local.target_group_id })).account.id;
      }
      await this.#accounts.bindGamAccount(accountId, email);
      await this.importSession(accountId);
    }
    await this.#operations.updateFromExternal(local.id, operation, accountId);
    return { operation, ...(accountId ? { accountId } : {}) };
  }

  async persistRemoteState(accountId: string, remote: ManagedAccountSummary) {
    const observedAt = new Date();
    await this.db.updateTable('account_operational_profiles').set({
      account_manager_plan_code: remote.personalPlan ?? null,
      account_manager_synced_at: observedAt
    }).where('account_id', '=', accountId).execute();
    const personal = await this.db.selectFrom('personal_spaces').select('id').where('account_id', '=', accountId).executeTakeFirstOrThrow();
    if (remote.personalPlan || remote.personalSubscription) {
      const subscription = remote.personalSubscription ?? {};
      const rawPlan = subscription.planType ?? remote.personalPlan ?? 'unknown';
      await this.db.insertInto('personal_subscription_snapshots').values({
        personal_space_id: personal.id,
        normalized_plan: normalizePersonalPlan(rawPlan),
        raw_plan_code: rawPlan,
        status: subscription.isDelinquent ? 'delinquent' : 'active',
        will_renew: subscription.willRenew ?? null,
        effective_at: subscription.activeStart ?? null,
        ends_at: subscription.activeUntil ?? null,
        payload: subscription as Record<string, unknown>,
        observed_at: observedAt
      }).execute();
    }
    if (remote.paymentMethods) {
      await this.db.transaction().execute(async (trx) => {
        await trx.deleteFrom('payment_method_summaries').where('personal_space_id', '=', personal.id).execute();
        if (remote.paymentMethods!.length) await trx.insertInto('payment_method_summaries').values(remote.paymentMethods!.map((item) => ({
          personal_space_id: personal.id,
          workspace_id: null,
          brand: item.brand ?? item.type ?? null,
          last4: item.last4 ?? null,
          expiry_month: item.expMonth ?? null,
          expiry_year: item.expYear ?? null,
          is_default: item.isDefault === true,
          observed_at: observedAt
        }))).execute();
      });
    }
    const seen = new Set<string>();
    for (const item of remote.workspaces ?? []) {
      if (!item.id?.trim()) continue;
      const workspace = await this.#workspaces.upsert({
        externalId: item.id, name: item.name ?? null,
        status: item.visible === false || item.status === 'inactive' ? 'inactive' : 'active',
        rawPlanCode: item.planType ?? null,
        normalizedPlan: normalizeWorkspacePlan(item.planType),
        nextRenewalAt: item.nextRenewalAt ?? null
      });
      seen.add(workspace.id);
      await this.#workspaces.upsertMembership({
        workspaceId: workspace.id, accountId, email: remote.email,
        normalizedRole: normalizeWorkspaceRole(item.role), rawRole: item.role ?? null,
        seatType: item.seatType ?? null, status: 'active', observedAt, source: 'gam_sync'
      });
    }
    const existing = await this.db.selectFrom('workspace_memberships').select(['id', 'workspace_id'])
      .where('account_id', '=', accountId).where('source', '=', 'gam_sync').where('status', '=', 'active').execute();
    for (const row of existing) if (!seen.has(row.workspace_id)) {
      await this.db.updateTable('workspace_memberships').set({ status: 'removed', observed_at: observedAt }).where('id', '=', row.id).execute();
    }
    await this.db.insertInto('account_activity_logs').values({
      account_id: accountId, workspace_id: null, kind: 'gam_sync',
      payload: { personalPlan: remote.personalPlan ?? null, workspaceCount: remote.workspaces?.length ?? 0 },
      source_file_sha256: null, source_line: null, source_bytes_sha256: null, occurred_at: observedAt
    }).execute();
  }

  private async accountRef(accountId: string): Promise<string> {
    const account = await this.#accounts.findById(accountId);
    if (!account) throw new ServiceError(404, '账号不存在');
    const binding = await this.db.selectFrom('gam_bindings').select('external_account_ref').where('account_id', '=', accountId).executeTakeFirst();
    if (!binding) throw new ServiceError(409, '账号尚未绑定 GAM');
    return binding.external_account_ref;
  }

  private require<K extends keyof AccountManagerGateway>(method: K): AccountManagerGateway {
    if (!this.manager?.[method]) throw new ServiceError(503, `GAM ${String(method)} 未配置`);
    return this.manager;
  }
}

function normalizePersonalPlan(value: string): 'free' | 'go' | 'plus' | 'pro_5x' | 'pro_20x' | 'unknown' {
  const key = value.toLowerCase();
  if (['free', 'go', 'plus', 'pro_5x', 'pro_20x'].includes(key)) return key as any;
  if (key.includes('prolite')) return 'pro_5x';
  if (key.includes('pro')) return 'pro_20x';
  if (key.includes('plus')) return 'plus';
  if (key.includes('go')) return 'go';
  return 'unknown';
}
function normalizeWorkspacePlan(value?: string): 'free' | 'business' | 'business_usage_based' | 'unknown' {
  const key = value?.toLowerCase() ?? '';
  if (key.includes('usage')) return 'business_usage_based';
  if (key.includes('business') || key.includes('team')) return 'business';
  if (key === 'free') return 'free';
  return 'unknown';
}
function normalizeWorkspaceRole(value?: string): 'owner' | 'admin' | 'member' | 'analytics_viewer' | 'unknown' {
  const key = value?.toLowerCase() ?? '';
  if (key.includes('owner')) return 'owner'; if (key.includes('admin')) return 'admin';
  if (key.includes('analytics')) return 'analytics_viewer'; if (key.includes('member') || key.includes('user')) return 'member';
  return 'unknown';
}

function mergeOperations(local: AccountManagerStateView['operations'], remote: AccountManagerStateView['operations']) {
  const values = new Map(remote.map((item) => [item.id, item]));
  for (const item of local) if (!item.id || !values.has(item.id)) values.set(item.id, item);
  return [...values.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

function stringFrom(value: Record<string, unknown> | undefined, key: string): string | undefined {
  const item = value?.[key];
  return typeof item === 'string' && item.trim() ? item.trim().toLowerCase() : undefined;
}
