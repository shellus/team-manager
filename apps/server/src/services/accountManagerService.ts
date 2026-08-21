import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type {
  AccountManagerStateView,
  RegisterAccountRequest,
  ResidentialProxyConfig
} from '@team-manager/shared';
import type { Database } from '../database/schema.js';
import type { AccountManagerGateway } from '../accountManagerClient.js';
import { AccountRepository } from '../repositories/accountRepository.js';
import { AutomationOperationRepository } from '../repositories/automationOperationRepository.js';
import { SessionRepository } from '../repositories/sessionRepository.js';
import { ServiceError } from '../serviceError.js';
import { ActivityLogRepository } from '../repositories/activityLogRepository.js';
import { AccountOperationalRepository } from '../repositories/accountOperationalRepository.js';

export class AccountManagerService {
  readonly #accounts: AccountRepository;
  readonly #operations: AutomationOperationRepository;
  readonly #activity: ActivityLogRepository;

  constructor(
    private readonly db: Kysely<Database>,
    private readonly sessions: SessionRepository,
    private readonly manager?: AccountManagerGateway,
    private readonly operational?: AccountOperationalRepository
  ) {
    this.#accounts = new AccountRepository(db);
    this.#operations = new AutomationOperationRepository(db);
    this.#activity = new ActivityLogRepository(db);
  }

  async state(accountId: string): Promise<AccountManagerStateView> {
    const localOperations = await this.#operations.listForAccount(accountId);
    if (!this.manager) return { operations: localOperations, errors: { service: 'GAM 未配置' } };
    const ref = await this.accountRef(accountId).catch((error) => {
      if (error instanceof ServiceError && error.status === 409) return undefined;
      throw error;
    });
    if (!ref) return { operations: localOperations };
    const [profileResult, proxyResult, operationsResult] = await Promise.allSettled([
      this.manager.accountProfile?.(ref) ?? Promise.resolve(undefined),
      this.manager.accountProxyConfig?.(ref) ?? Promise.resolve(undefined),
      this.manager.listAccountOperations?.(ref) ?? Promise.resolve([])
    ]);
    const profile = fulfilled(profileResult);
    const proxy = fulfilled(proxyResult);
    const mirroredExternalIds = new Set((await this.db.selectFrom('automation_operations')
      .select('external_operation_id').where('account_id', '=', accountId)
      .where('external_operation_id', 'is not', null).execute())
      .map((item) => item.external_operation_id!));
    const remoteOperations = (fulfilled(operationsResult) ?? [])
      .filter((operation) => !mirroredExternalIds.has(operation.id));
    const errors = {
      ...(profileResult.status === 'rejected' ? { profile: errorMessage(profileResult.reason) } : {}),
      ...(proxyResult.status === 'rejected' ? { proxy: errorMessage(proxyResult.reason) } : {}),
      ...(operationsResult.status === 'rejected' ? { operations: errorMessage(operationsResult.reason) } : {})
    };
    if (profile) await this.db.updateTable('account_operational_profiles').set({ profile_status: profile.status, profile_checked_at: new Date() }).where('account_id', '=', accountId).execute();
    return {
      ...(profile ? { profile } : {}),
      ...(proxy ? { proxy } : {}),
      operations: mergeOperations(localOperations, remoteOperations),
      ...(Object.keys(errors).length ? { errors } : {})
    };
  }

  async enroll(accountId: string) {
    const manager = this.require('startAccountImport');
    const account = await this.#accounts.findById(accountId);
    if (!account) throw new ServiceError(404, '账号不存在');
    const existingBinding = await this.db.selectFrom('gam_bindings').select('external_account_ref')
      .where('account_id', '=', accountId).executeTakeFirst();
    if (existingBinding) return this.state(accountId);
    const existingEnrollment = (await this.#operations.listForAccount(accountId)).find((item) =>
      item.type === 'import_account' && !['failed', 'interrupted'].includes(item.status)
    );
    if (existingEnrollment) {
      if (existingEnrollment.status === 'succeeded') {
        await this.reconcileEnrollment(existingEnrollment.id);
        return this.state(accountId);
      }
      return existingEnrollment;
    }
    const session = await this.sessions.currentSession(accountId);
    if (!session) throw new ServiceError(409, '账号没有可用于 GAM 纳管的 Session');
    const operationId = await this.#operations.start({
      accountId,
      kind: 'import_account',
      idempotencyKey: randomUUID(),
      safeRequestSummary: { email: account.email, authMethod: 'existing_session' }
    });
    const operation = await manager.startAccountImport!({
      email: account.email,
      authMethod: 'existing_session',
      session: session as Parameters<NonNullable<AccountManagerGateway['startAccountImport']>>[0]['session'],
      requestTag: `team-manager:${operationId}`,
      clientReference: accountId
    });
    await this.#operations.attach(operationId, operation);
    await this.#activity.log({ accountId, kind: 'gam_enrollment_requested', payload: { operationId, authMethod: 'existing_session' } });
    return this.#operations.view(operationId);
  }

  async registrationProxy(operationId: string) {
    const operation = await this.registrationOperation(operationId);
    const manager = this.require('operationProxyConfig');
    return manager.operationProxyConfig!(operation.external_operation_id!);
  }

  async setRegistrationProxy(operationId: string, input: ResidentialProxyConfig) {
    validateProxy(input);
    const operation = await this.registrationOperation(operationId);
    const manager = this.require('configureOperationProxy');
    return manager.configureOperationProxy!(operation.external_operation_id!, normalizedProxy(input));
  }

  async startProfile(accountId: string) {
    const manager = this.require('startAccountProfile');
    const profile=await manager.startAccountProfile!(await this.accountRef(accountId));await this.db.updateTable('account_operational_profiles').set({profile_status:profile.status,profile_checked_at:new Date()}).where('account_id','=',accountId).execute();return profile;
  }

  async stopProfile(accountId: string) {
    const manager = this.require('stopAccountProfile');
    const profile=await manager.stopAccountProfile!(await this.accountRef(accountId));await this.db.updateTable('account_operational_profiles').set({profile_status:profile.status,profile_checked_at:new Date()}).where('account_id','=',accountId).execute();return profile;
  }

  async refreshSession(accountId: string) {
    const manager = this.require('refreshAccountSession');
    const account = await this.#accounts.findById(accountId);
    if (!account) throw new ServiceError(404, '账号不存在');
    const delivery = await manager.refreshAccountSession!(await this.accountRef(accountId));
    if (delivery.email.trim().toLowerCase() !== account.normalized_email
      || delivery.session.user.email.trim().toLowerCase() !== account.normalized_email) {
      throw new ServiceError(409, 'GAM 刷新结果与本地账号邮箱不一致');
    }
    const personal = await this.db.selectFrom('personal_spaces').select('id')
      .where('account_id', '=', accountId).executeTakeFirstOrThrow();
    await this.sessions.replaceCurrent({
      accountId,
      personalSpaceId: personal.id,
      session: delivery.session,
      source: 'gam_profile_refresh'
    });
    await this.#activity.log({
      accountId,
      kind: 'session_refreshed_from_gam_profile',
      payload: { email: account.email }
    });
    return { updated: true, email: account.email };
  }

  async setProxy(accountId: string, input: ResidentialProxyConfig) {
    validateProxy(input);
    const manager = this.require('configureAccountProxy');
    return manager.configureAccountProxy!(await this.accountRef(accountId), normalizedProxy(input));
  }

  async ensureHttpProxy(accountId: string): Promise<string | undefined> {
    const existing = await this.operational?.proxy(accountId);
    if (existing) return existing;
    if (!this.manager?.accountHttpProxy || !this.operational) return undefined;
    const ref = await this.accountRef(accountId).catch((error) => {
      if (error instanceof ServiceError && error.status === 409) return undefined;
      throw error;
    });
    if (!ref) return undefined;
    const result = await this.manager.accountHttpProxy(ref);
    const proxy = result.proxy?.trim();
    if (!proxy) throw new ServiceError(502, 'GAM 未返回账号 HTTP 代理');
    await this.operational.setProxy(accountId, proxy);
    return proxy;
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
      const delivery = await this.require('registrationSessionDelivery')
        .registrationSessionDelivery!(local.external_operation_id);
      const email = delivery.email.trim().toLowerCase();
      if (!email) throw new ServiceError(502, 'GAM 注册成功但未返回邮箱');
      const operationEmail = operation.email?.trim().toLowerCase()
        || stringFrom(operation.result, 'email')
        || operation.accountId?.trim().toLowerCase();
      if (operationEmail && operationEmail !== email) throw new ServiceError(409, 'GAM 注册结果与 Session 交付邮箱不一致');
      if (delivery.session.user.email.trim().toLowerCase() !== email) {
        throw new ServiceError(409, 'GAM Session 交付邮箱与注册账号不一致');
      }
      const existing = await this.#accounts.findByEmail(email);
      if (existing) accountId = existing.id;
      else {
        if (!local.target_group_id) throw new ServiceError(500, '注册操作缺少目标分组');
        accountId = (await this.#accounts.create({ email, groupId: local.target_group_id })).account.id;
      }
      await this.#accounts.bindGamAccount(accountId, email);
      const personal = await this.db.selectFrom('personal_spaces').select('id')
        .where('account_id', '=', accountId).executeTakeFirstOrThrow();
      await this.sessions.replaceCurrent({
        accountId,
        personalSpaceId: personal.id,
        session: delivery.session,
        source: 'gam_registration_delivery'
      });
      await this.ensureHttpProxy(accountId).catch(() => undefined);
    }
    await this.#operations.updateFromExternal(local.id, operation, accountId);
    if (operation.status === 'succeeded' && accountId) {
      await this.require('acknowledgeRegistrationSessionDelivery')
        .acknowledgeRegistrationSessionDelivery!(local.external_operation_id);
    }
    return { operation, ...(accountId ? { accountId } : {}) };
  }

  async reconcileEnrollment(operationId: string) {
    const local = await this.db.selectFrom('automation_operations').selectAll().where('id', '=', operationId)
      .where('kind', '=', 'import_account').executeTakeFirst();
    if (!local?.external_operation_id || !local.account_id) throw new ServiceError(404, 'GAM 纳管操作不存在');
    const manager = this.require('operation');
    const operation = await manager.operation!(local.external_operation_id);
    if (operation.status === 'succeeded') {
      const account = await this.#accounts.findById(local.account_id);
      if (!account) throw new ServiceError(404, '账号不存在');
      await this.#accounts.bindGamAccount(account.id, account.email);
      await this.ensureHttpProxy(account.id).catch(() => undefined);
    }
    await this.#operations.updateFromExternal(local.id, operation, local.account_id);
    return operation;
  }

  private async accountRef(accountId: string): Promise<string> {
    const account = await this.#accounts.findById(accountId);
    if (!account) throw new ServiceError(404, '账号不存在');
    const binding = await this.db.selectFrom('gam_bindings').select('external_account_ref').where('account_id', '=', accountId).executeTakeFirst();
    if (!binding) throw new ServiceError(409, '账号尚未绑定 GAM');
    return binding.external_account_ref;
  }

  private async registrationOperation(operationId: string) {
    const operation = await this.db.selectFrom('automation_operations').selectAll().where('id', '=', operationId)
      .where('kind', '=', 'register_account').executeTakeFirst();
    if (!operation?.external_operation_id) throw new ServiceError(404, '注册操作不存在');
    return operation;
  }

  private require<K extends keyof AccountManagerGateway>(method: K): AccountManagerGateway {
    if (!this.manager?.[method]) throw new ServiceError(503, `GAM ${String(method)} 未配置`);
    return this.manager;
  }
}

function fulfilled<T>(result: PromiseSettledResult<T>): T | undefined {
  return result.status === 'fulfilled' ? result.value : undefined;
}
function errorMessage(value: unknown): string { return value instanceof Error ? value.message : String(value); }
function validateProxy(input: ResidentialProxyConfig) {
  if (!input.sid.trim()) throw new ServiceError(400, '代理 SID 不能为空');
  if (!/^[A-Z]{2}$/i.test(input.country)) throw new ServiceError(400, '代理国家必须是两个字母');
  if (input.asn && (input.state || input.city)) throw new ServiceError(400, 'ASN 与州/城市不能同时设置');
  if (input.city && !input.state) throw new ServiceError(400, '设置城市时必须同时设置州/省');
}
function normalizedProxy(input: ResidentialProxyConfig): ResidentialProxyConfig {
  return { ...input, country: input.country.toUpperCase() };
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
