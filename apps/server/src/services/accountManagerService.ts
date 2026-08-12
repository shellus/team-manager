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

export class AccountManagerService {
  readonly #accounts: AccountRepository;
  readonly #operations: AutomationOperationRepository;

  constructor(
    private readonly db: Kysely<Database>,
    private readonly sessions: SessionRepository,
    private readonly manager?: AccountManagerGateway
  ) {
    this.#accounts = new AccountRepository(db);
    this.#operations = new AutomationOperationRepository(db);
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
    return manager.startAccountProfile!(await this.accountRef(accountId));
  }

  async stopProfile(accountId: string) {
    const manager = this.require('stopAccountProfile');
    return manager.stopAccountProfile!(await this.accountRef(accountId));
  }

  async setProxy(accountId: string, input: ResidentialProxyConfig) {
    const manager = this.require('configureAccountProxy');
    return manager.configureAccountProxy!(await this.accountRef(accountId), input);
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
    return operation;
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
    return operation;
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

  private async persistRemoteState(accountId: string, remote: { personalPlan?: string; paymentMethods?: Array<any> }) {
    await this.db.updateTable('account_operational_profiles').set({
      account_manager_plan_code: remote.personalPlan ?? null,
      account_manager_synced_at: new Date()
    }).where('account_id', '=', accountId).execute();
    const personal = await this.db.selectFrom('personal_spaces').select('id').where('account_id', '=', accountId).executeTakeFirstOrThrow();
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
          observed_at: new Date()
        }))).execute();
      });
    }
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

function mergeOperations(local: AccountManagerStateView['operations'], remote: AccountManagerStateView['operations']) {
  const values = new Map(remote.map((item) => [item.id, item]));
  for (const item of local) if (!item.id || !values.has(item.id)) values.set(item.id, item);
  return [...values.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

function stringFrom(value: Record<string, unknown> | undefined, key: string): string | undefined {
  const item = value?.[key];
  return typeof item === 'string' && item.trim() ? item.trim().toLowerCase() : undefined;
}
