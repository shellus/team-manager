import type {
  AccountManagerOperationView,
  AddPersonalPaymentMethodRequest,
  CodexAuthStart,
  CodexCredentialJson,
  CodexPersonalAccessTokenCredentialJson,
  CodexQuotaSnapshot,
  OpenPro5xRequest,
  Pro5xRenewalCancellationResult,
  PersonalPaymentMethodDefaults,
  Pro5xSubscriptionView,
  Subaccount,
  SubaccountAccountManagerStatus,
  SubaccountAuthLog,
  SubaccountLocalProfileView,
  SubaccountRegistrationJobView,
  AccountManagerRuntimeStatus,
  AccountManagerProfileView,
  ResidentialProxyConfig,
  SubaccountSummaryView,
  SubaccountView
} from '@team-manager/shared';
import {
  createCodexAuthSession,
  exchangeCodexCallback,
  type CodexAuthSession
} from './codexAuth.js';
import { fetchCodexQuota } from './codexQuota.js';
import { ServiceError } from './teamService.js';
import {
  ChatGptApi,
  ChatGptApiError,
  type CodexPersonalAccessTokenResponse
} from './chatgptApi.js';
import {
  ChatGptWebSessionError,
  fetchWorkspaceWebAccessTokenFromSessionToken,
  fetchWorkspaceWebSessionFromStoredCookies,
  fetchWorkspaceWebSessionFromSessionToken,
  resolveChatGptSessionImportInput,
} from './chatgptWebSession.js';
import {
  normalizePro5xCardLast4,
  pro5xOperationCardLast4,
  successfulPro5xCardLast4ByAccount
} from './pro5xPaymentCard.js';
import { createTransport, type Transport } from './transport.js';
import { SubaccountStore } from './subaccountStore.js';
import {
  ACCOUNT_MANAGER_REQUEST_TAGS,
  AccountManagerError,
  registrationJobFromOperation,
  type AccountManagerGateway,
  type ManagedAccountSummary
} from './accountManagerClient.js';
import { accountManagerProfilesByLocalId } from './accountManagerProfiles.js';
import {
  accountEnrollmentOperationEmail,
  findLatestAccountEnrollmentOperation,
  isAccountEnrollmentOperation,
  isTerminalAccountEnrollmentOperation
} from './accountManagerEnrollment.js';
import {
  cancelPro5xRenewal,
  Pro5xSubscriptionError,
  readPro5xSubscription
} from './pro5xSubscription.js';

const CODEX_PAT_NAME = 'team-manager';
const CODEX_PAT_TTL_SECONDS = 30 * 24 * 60 * 60;
const CODEX_LOCAL_ACCESS_SCOPE = 'chatgpt.workspace.feature.allow-codex-local-access.access';

export class SubaccountService {
  private readonly codexSessions = new Map<
    string,
    { subaccountId: string; session: CodexAuthSession; targetChatgptAccountId?: string }
  >();

  constructor(
    private readonly store: SubaccountStore,
    private readonly quotaTransport: Transport = createTransport(),
    private readonly webTransport: Transport = createTransport(),
    private readonly accountManager?: AccountManagerGateway,
    private readonly codexFetch?: typeof fetch
  ) {}

  list(): SubaccountView[] {
    return this.store.list();
  }

  listSummaries(): SubaccountSummaryView[] {
    return this.store.listSummaries();
  }

  detail(id: string): SubaccountView {
    const subaccount = this.store.detail(id);
    if (!subaccount) throw new ServiceError(404, `子号不存在: ${id}`);
    return subaccount;
  }

  async pro5xSubscription(id: string): Promise<Pro5xSubscriptionView | null> {
    const subaccount = this.requireSubaccount(id);
    try {
      const api = await this.directPro5xApiFor(subaccount);
      const subscription = await readPro5xSubscription(api);
      await this.store.update(id, {
        webAccessTokenStatus: 'valid',
        webAccessTokenCheckedAt: Date.now(),
        lastError: undefined
      });
      return subscription;
    } catch (error) {
      throw asServiceError(error);
    }
  }

  async cancelPro5xRenewal(id: string): Promise<Pro5xRenewalCancellationResult> {
    const subaccount = this.requireSubaccount(id);
    try {
      const result = await cancelPro5xRenewal(await this.directPro5xApiFor(subaccount));
      const checkedAt = Date.now();
      await this.store.update(id, {
        webAccessTokenStatus: 'valid',
        webAccessTokenCheckedAt: checkedAt,
        lastRefreshAt: checkedAt,
        lastError: undefined
      });
      await this.store.appendLog(id, {
        phase: 'pro5x_renewal_cancel',
        status: 'success',
        message: result.idempotent ? 'Pro 5x 已处于不续订状态' : '已关闭 Pro 5x 自动续订',
        data: {
          idempotent: result.idempotent,
          subscription: result.subscription
        }
      });
      return result;
    } catch (error) {
      await this.persistWebRequestError(
        id,
        'pro5x_renewal_cancel',
        '关闭 Pro 5x 自动续订失败',
        error
      );
      throw asServiceError(error);
    }
  }

  localProfile(id: string): SubaccountLocalProfileView {
    const profile = this.store.localProfile(id);
    if (!profile) throw new ServiceError(404, `子号不存在: ${id}`);
    return profile;
  }

  async listRegistrationJobs(): Promise<SubaccountRegistrationJobView[]> {
    if (!this.accountManager) return [];
    return this.reconcileAccountManagerOperations(
      await this.callAccountManager(() => this.accountManager!.listRegistrations(ACCOUNT_MANAGER_REQUEST_TAGS.subaccount))
    );
  }

  async startSubaccountRegistration(input: {
    mailGroup?: string;
    email?: string;
    password?: string;
    resumeExisting?: boolean;
    country?: string;
    groupName?: string;
  }): Promise<SubaccountRegistrationJobView> {
    if (!this.accountManager) throw new ServiceError(503, '未配置 GPT Account Manager');
    return this.callAccountManager(() => this.accountManager!.startRegistration({
      mailGroup: input.mailGroup,
      email: input.email,
      password: input.password,
      resumeExisting: input.resumeExisting,
      country: normalizeSubaccountRegistrationCountry(input.country),
      clientReference: normalizeSubaccountRegistrationGroupName(input.groupName),
      requestTag: ACCOUNT_MANAGER_REQUEST_TAGS.subaccount
    }));
  }

  async retrySubaccountRegistration(jobId: string): Promise<SubaccountRegistrationJobView> {
    if (!this.accountManager) throw new ServiceError(503, '未配置 GPT Account Manager');
    await this.requireSubaccountRegistration(jobId);
    return this.callAccountManager(() => this.accountManager!.retryRegistration(jobId));
  }

  async cancelSubaccountRegistration(jobId: string): Promise<SubaccountRegistrationJobView> {
    if (!this.accountManager) throw new ServiceError(503, '未配置 GPT Account Manager');
    await this.requireSubaccountRegistration(jobId);
    return registrationJobFromOperation(
      await this.callAccountManager(() => this.accountManager!.terminateOperation(jobId))
    );
  }

  async rotateSubaccountRegistrationIp(jobId: string): Promise<SubaccountRegistrationJobView> {
    if (!this.accountManager) throw new ServiceError(503, '未配置 GPT Account Manager');
    const operation = await this.requireSubaccountRegistration(jobId);
    if (operation.status !== 'waiting_manual') {
      throw new ServiceError(409, '只有等待人工处理的子号注册任务可以更换IP');
    }
    return registrationJobFromOperation(
      await this.callAccountManager(() => this.accountManager!.rotateOperationIp(jobId))
    );
  }

  async registrationProxyConfig(jobId: string): Promise<ResidentialProxyConfig> {
    const operation = await this.requireSubaccountRegistration(jobId);
    return this.callAccountManager(() => this.accountManager!.operationProxyConfig(operation.id));
  }

  async configureRegistrationProxy(
    jobId: string,
    input: ResidentialProxyConfig
  ): Promise<ResidentialProxyConfig> {
    const operation = await this.requireSubaccountRegistration(jobId);
    return this.callAccountManager(() => this.accountManager!.configureOperationProxy(operation.id, input));
  }

  async removeSubaccountRegistrationJob(jobId: string): Promise<boolean> {
    if (!this.accountManager) throw new ServiceError(503, '未配置 GPT Account Manager');
    await this.requireSubaccountRegistration(jobId);
    return this.callAccountManager(() => this.accountManager!.removeOperation(jobId));
  }

  private async requireSubaccountRegistration(jobId: string) {
    const operation = await this.callAccountManager(() => this.accountManager!.operation(jobId));
    if (
      operation.type !== 'register' ||
      operation.requestSummary?.requestTag !== ACCOUNT_MANAGER_REQUEST_TAGS.subaccount
    ) {
      throw new ServiceError(404, `子号注册操作不存在: ${jobId}`);
    }
    return operation;
  }

  private async reconcileAccountManagerOperations(
    jobs: SubaccountRegistrationJobView[]
  ): Promise<SubaccountRegistrationJobView[]> {
    if (!this.accountManager) return jobs;
    const reconciled: SubaccountRegistrationJobView[] = [];
    for (const job of jobs) {
      if (job.status !== 'succeeded' || !job.email) {
        reconciled.push(job);
        continue;
      }
      const existing = this.store.getByEmail(job.email);
      if (existing?.managedAccountEmail === job.email.toLowerCase()) {
        reconciled.push({ ...job, subaccountId: existing.id });
        continue;
      }
      const session = await this.callAccountManager(() => this.accountManager!.session(job.email!));
      const proxy = await this.managedAccountHttpProxy(job.email!);
      const registered = await this.store.saveManagedSubaccount({
        managedAccountEmail: job.email,
        email: job.email,
        groupName: job.groupName,
        ...(proxy ? { proxy } : {}),
        session,
        status: 'session_ready'
      });
      await this.store.appendLog(registered.id, {
        phase: 'account_manager_session_import',
        status: registered.status,
        message: '已从 GPT Account Manager 取得 Web Session 并关联账号引用',
        data: { managedAccountEmail: registered.managedAccountEmail, operationId: job.id }
      });
      try {
        await this.callAccountManager(() => this.accountManager!.removeOperation(job.id));
      } catch (error) {
        await this.store.appendLog(registered.id, {
          phase: 'account_manager_operation_cleanup',
          status: 'error',
          message: `账号已导入，但 Account Manager 操作清理失败: ${(error as Error).message}`,
          data: { operationId: job.id }
        });
      }
      reconciled.push({ ...job, subaccountId: registered.id });
    }
    return reconciled;
  }

  private async callAccountManager<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof AccountManagerError) throw new ServiceError(error.status, error.message);
      throw error;
    }
  }

  async getRegistrationRuntimeStatus(): Promise<AccountManagerRuntimeStatus> {
    if (!this.accountManager) {
      return { configured: false, reachable: false, error: '未配置 GPT Account Manager' };
    }
    try {
      const health = await this.accountManager.health();
      return {
        configured: health.accountRegistrationConfigured === true,
        reachable: health.status === 'ok',
        ...(health.pro5xPromoCode ? { pro5xPromoCode: health.pro5xPromoCode } : {}),
        ...(health.accountRegistrationConfigured === true ? {} : { error: 'GPT Account Manager 注册环境未配置完整' })
      };
    } catch (error) {
      return {
        configured: true,
        reachable: false,
        error: error instanceof AccountManagerError ? error.message : (error as Error).message
      };
    }
  }

  async startAccountManagement(id: string): Promise<SubaccountAccountManagerStatus> {
    const subaccount = this.requireSubaccount(id);
    if (!this.accountManager) throw new ServiceError(503, '未配置 GPT Account Manager');
    if (subaccount.managedAccountEmail) return this.accountStatus(id);

    const email = subaccount.email.trim().toLowerCase();
    if (!email) throw new ServiceError(400, '子号邮箱不能为空');
    const canBootstrapExistingSession = Boolean(
      subaccount.sessionToken?.trim()
      && subaccount.chatgptAccountId?.trim()
      && subaccount.webAccessToken?.trim()
    );
    const managed = await this.findManagedAccount(email);
    if (managed) {
      await this.linkExistingManagedSubaccount(id, email);
      await this.removeTerminalEnrollmentOperations(email);
      return this.accountStatus(id);
    }

    const operations = await this.callAccountManager(() => this.accountManager!.listOperations({ type: 'import' }));
    const existing = findLatestAccountEnrollmentOperation(operations, email);
    if (existing && existing.status !== 'failed' && existing.status !== 'interrupted') {
      return this.reconcileAccountEnrollment(id, email, existing);
    }
    for (const operation of operations.filter((item) =>
      accountEnrollmentOperationEmail(item) === email
      && (item.status === 'failed' || item.status === 'interrupted')
    )) {
      await this.safeRemoveAccountOperation(operation.id);
    }

    const operation = await this.callAccountManager(() => this.accountManager!.startAccountImport({
      email,
      authMethod: canBootstrapExistingSession ? 'existing_session' : 'email_otp',
      ...(canBootstrapExistingSession
        ? {
            session: {
              user: { email: subaccount.email },
              account: { id: subaccount.chatgptAccountId! },
              accessToken: subaccount.webAccessToken!,
              sessionToken: subaccount.sessionToken!
            }
          }
        : {})
    }));
    await this.store.appendLog(id, {
      phase: 'account_manager_enrollment_start',
      status: operation.status,
      message: canBootstrapExistingSession
        ? '已使用现有 Web Session 发起 GAM 纳管'
        : '已发起 GAM 邮箱验证码登录纳管',
      data: {
        operationId: operation.id,
        authMethod: canBootstrapExistingSession ? 'existing_session' : 'email_otp'
      }
    });
    return unmanagedSubaccountStatus(operation);
  }

  async accountProfile(id: string): Promise<AccountManagerProfileView> {
    const email = this.requireManagedAccountEmail(id);
    return this.callAccountManager(() => this.accountManager!.accountProfile(email));
  }

  async accountProfiles(): Promise<Record<string, AccountManagerProfileView>> {
    return this.callAccountManager(() => accountManagerProfilesByLocalId(
      this.accountManager,
      this.store.listSummaries()
    ));
  }

  async startAccountProfile(id: string): Promise<AccountManagerProfileView> {
    const email = this.requireManagedAccountEmail(id);
    return this.callAccountManager(() => this.accountManager!.startAccountProfile(email));
  }

  async stopAccountProfile(id: string): Promise<AccountManagerProfileView> {
    const email = this.requireManagedAccountEmail(id);
    return this.callAccountManager(() => this.accountManager!.stopAccountProfile(email));
  }

  async accountProxyConfig(id: string): Promise<ResidentialProxyConfig> {
    const email = this.requireManagedAccountEmail(id);
    return this.callAccountManager(() => this.accountManager!.accountProxyConfig(email));
  }

  async configureAccountProxy(
    id: string,
    input: ResidentialProxyConfig
  ): Promise<ResidentialProxyConfig> {
    const email = this.requireManagedAccountEmail(id);
    return this.callAccountManager(() => this.accountManager!.configureAccountProxy(email, input));
  }

  async accountStatus(id: string): Promise<SubaccountAccountManagerStatus> {
    const subaccount = this.requireSubaccount(id);
    if (!this.accountManager) {
      return {
        configured: false,
        reachable: false,
        managed: false,
        hasPro5x: false,
        error: '未配置 GPT Account Manager'
      };
    }
    const email = subaccount.managedAccountEmail?.trim().toLowerCase();
    if (!email) {
      try {
        const operations = await this.accountManager.listOperations({ type: 'import' });
        return this.reconcileAccountEnrollment(
          id,
          subaccount.email,
          findLatestAccountEnrollmentOperation(operations, subaccount.email)
        );
      } catch (error) {
        return {
          configured: true,
          reachable: false,
          managed: false,
          hasPro5x: false,
          accountEmail: subaccount.email.trim().toLowerCase(),
          error: error instanceof AccountManagerError ? error.message : (error as Error).message
        };
      }
    }

    try {
      const managed = await this.accountManager.account(email);
      let pro5xOperation: AccountManagerOperationView | undefined = (
        await this.accountManager.listAccountOperations(email)
      )
        .filter(isSubaccountPro5xOperation)
        .sort((left, right) => right.createdAt - left.createdAt)[0];
      const operationCardLast4 = pro5xOperationCardLast4(pro5xOperation);
      if (pro5xOperation?.status === 'succeeded' && managed.hasPro5x) {
        await this.safeRemoveAccountOperation(pro5xOperation.id);
        pro5xOperation = undefined;
      }
      const hasPro5x = managed.hasPro5x === true || pro5xOperation?.status === 'succeeded';
      const cardLast4 = hasPro5x && !operationCardLast4 && !subaccount.accountManagerPro5xCardLast4
        ? await this.historicalPro5xCardLast4(email)
        : operationCardLast4;
      await this.cacheAccountManagerState(id, hasPro5x, { cardLast4 });
      return {
        configured: true,
        reachable: true,
        managed: true,
        hasPro5x,
        accountEmail: email,
        ...(pro5xOperation ? { pro5xOperation } : {}),
        ...(pro5xOperation?.errorMessage ? { error: pro5xOperation.errorMessage } : {})
      };
    } catch (error) {
      if (error instanceof AccountManagerError && error.status === 404) {
        return {
          configured: true,
          reachable: true,
          managed: false,
          hasPro5x: false,
          accountEmail: email,
          error: '该邮箱尚未由 GPT Account Manager 管理'
        };
      }
      return {
        configured: true,
        reachable: false,
        managed: false,
        hasPro5x: false,
        accountEmail: email,
        error: error instanceof AccountManagerError ? error.message : (error as Error).message
      };
    }
  }

  async accountStatuses(): Promise<Record<string, SubaccountAccountManagerStatus>> {
    const subaccounts = this.store.listSummaries();
    if (!this.accountManager?.listAccounts) {
      const entries = await Promise.all(subaccounts.map(async (subaccount) => [
        subaccount.id,
        await this.accountStatus(subaccount.id)
      ] as const));
      return Object.fromEntries(entries);
    }

    try {
      const [managedAccounts, allOperations] = await Promise.all([
        this.accountManager.listAccounts(),
        this.accountManager.listOperations()
      ]);
      const managedByEmail = new Map(
        managedAccounts.map((account) => [account.email.trim().toLowerCase(), account])
      );
      const operationsByEmail = new Map<string, AccountManagerOperationView[]>();
      for (const operation of allOperations.filter(isSubaccountPro5xOperation)) {
        const email = operationAccountEmail(operation);
        if (!email) continue;
        const current = operationsByEmail.get(email) ?? [];
        current.push(operation);
        operationsByEmail.set(email, current);
      }
      const enrollmentOperationsByEmail = new Map<string, AccountManagerOperationView[]>();
      for (const operation of allOperations.filter(isAccountEnrollmentOperation)) {
        const email = accountEnrollmentOperationEmail(operation);
        if (!email) continue;
        const current = enrollmentOperationsByEmail.get(email) ?? [];
        current.push(operation);
        enrollmentOperationsByEmail.set(email, current);
      }

      const needsPaymentHistory = subaccounts.some((subaccount) => {
        const email = subaccount.managedAccountEmail?.trim().toLowerCase();
        const managed = email ? managedByEmail.get(email) : undefined;
        if (!email || !managed) return false;
        const pro5xOperation = (operationsByEmail.get(email) ?? [])
          .sort((left, right) => right.createdAt - left.createdAt)[0];
        const hasPro5x = managed.hasPro5x === true || pro5xOperation?.status === 'succeeded';
        return hasPro5x
          && !subaccount.accountManagerPro5xCardLast4
          && !pro5xOperationCardLast4(pro5xOperation);
      });
      const historicalCardLast4ByAccount = needsPaymentHistory
        ? await this.historicalPro5xCardLast4ByAccount()
        : new Map<string, string>();

      for (const subaccount of subaccounts) {
        const email = subaccount.managedAccountEmail?.trim().toLowerCase();
        const managed = email ? managedByEmail.get(email) : undefined;
        if (managed) {
          const pro5xOperation = (operationsByEmail.get(email!) ?? [])
            .sort((left, right) => right.createdAt - left.createdAt)[0];
          await this.cacheAccountManagerState(
            subaccount.id,
            managed.hasPro5x === true || pro5xOperation?.status === 'succeeded',
            {
              cardLast4: pro5xOperationCardLast4(pro5xOperation)
                ?? historicalCardLast4ByAccount.get(email!),
              refreshTimestamp: false
            }
          );
        }
      }

      const entries = await Promise.all(subaccounts.map(async (subaccount) => {
        const email = subaccount.managedAccountEmail?.trim().toLowerCase();
        if (!email) {
          const localEmail = subaccount.email.trim().toLowerCase();
          const enrollmentOperation = (enrollmentOperationsByEmail.get(localEmail) ?? [])
            .sort((left, right) => right.createdAt - left.createdAt)[0];
          const imported = managedByEmail.get(localEmail);
          if (enrollmentOperation?.status === 'succeeded' && imported) {
            await this.linkImportedSubaccount(subaccount.id, localEmail, enrollmentOperation.id);
            await this.removeTerminalEnrollmentOperations(localEmail);
            const pro5xOperation = (operationsByEmail.get(localEmail) ?? [])
              .sort((left, right) => right.createdAt - left.createdAt)[0];
            return [
              subaccount.id,
              managedSubaccountStatus(localEmail, imported.hasPro5x === true, pro5xOperation)
            ] as const;
          }
          return [
            subaccount.id,
            unmanagedSubaccountStatus(
              enrollmentOperation,
              enrollmentOperation?.status === 'succeeded'
                ? 'GAM 导入已完成，但账号状态尚未可读取，正在等待同步'
                : undefined
            )
          ] as const;
        }
        const managed = managedByEmail.get(email);
        if (!managed) {
          return [subaccount.id, missingManagedSubaccountStatus(email)] as const;
        }
        const pro5xOperation = (operationsByEmail.get(email) ?? [])
          .sort((left, right) => right.createdAt - left.createdAt)[0];
        if (pro5xOperation?.status === 'succeeded' && managed.hasPro5x) {
          return [subaccount.id, await this.accountStatus(subaccount.id)] as const;
        }
        return [subaccount.id, managedSubaccountStatus(email, managed.hasPro5x === true, pro5xOperation)] as const;
      }));
      return Object.fromEntries(entries);
    } catch (error) {
      const message = error instanceof AccountManagerError ? error.message : (error as Error).message;
      return Object.fromEntries(subaccounts.map((subaccount) => [
        subaccount.id,
        subaccount.managedAccountEmail
          ? unreachableManagedSubaccountStatus(subaccount.managedAccountEmail, message)
          : unmanagedSubaccountStatus()
      ]));
    }
  }

  private async cacheAccountManagerState(
    id: string,
    hasPro5x: boolean,
    options: { cardLast4?: string; refreshTimestamp?: boolean } = {}
  ): Promise<void> {
    const current = this.store.get(id);
    if (!current) return;
    const cardLast4 = hasPro5x
      ? normalizePro5xCardLast4(options.cardLast4) ?? current.accountManagerPro5xCardLast4
      : undefined;
    if (
      options.refreshTimestamp === false
      && current.accountManagerHasPro5x === hasPro5x
      && current.accountManagerPro5xCardLast4 === cardLast4
      && typeof current.accountManagerSyncedAt === 'number'
    ) return;
    await this.store.update(id, {
      accountManagerHasPro5x: hasPro5x,
      accountManagerPro5xCardLast4: cardLast4,
      accountManagerSyncedAt: Date.now()
    });
  }

  private async historicalPro5xCardLast4(email: string): Promise<string | undefined> {
    return (await this.historicalPro5xCardLast4ByAccount()).get(email.trim().toLowerCase());
  }

  private async historicalPro5xCardLast4ByAccount(): Promise<Map<string, string>> {
    try {
      return successfulPro5xCardLast4ByAccount(
        await this.accountManager!.pro5xPaymentStatistics()
      );
    } catch {
      return new Map();
    }
  }

  private async reconcileAccountEnrollment(
    id: string,
    email: string,
    operation?: AccountManagerOperationView
  ): Promise<SubaccountAccountManagerStatus> {
    if (operation?.status !== 'succeeded') {
      return unmanagedSubaccountStatus(operation);
    }
    const normalizedEmail = email.trim().toLowerCase();
    const managed = await this.findManagedAccount(normalizedEmail);
    if (!managed) {
      return unmanagedSubaccountStatus(
        operation,
        'GAM 导入已完成，但账号状态尚未可读取，正在等待同步'
      );
    }
    await this.linkImportedSubaccount(id, normalizedEmail, operation.id);
    await this.removeTerminalEnrollmentOperations(normalizedEmail);
    return this.accountStatus(id);
  }

  private async findManagedAccount(email: string): Promise<ManagedAccountSummary | undefined> {
    try {
      return await this.accountManager!.account(email);
    } catch (error) {
      if (error instanceof AccountManagerError && error.status === 404) return undefined;
      if (error instanceof AccountManagerError) throw new ServiceError(error.status, error.message);
      throw error;
    }
  }

  private async linkExistingManagedSubaccount(id: string, email: string): Promise<SubaccountView> {
    const existing = this.requireSubaccount(id);
    if (existing.managedAccountEmail?.trim().toLowerCase() === email && existing.proxy) return this.detail(id);
    const proxy = await this.managedAccountHttpProxy(email);
    const updated = await this.store.update(id, {
      managedAccountEmail: email,
      ...(proxy ? { proxy } : {})
    });
    if (!updated) throw new ServiceError(404, `子号不存在: ${id}`);
    await this.store.appendLog(id, {
      phase: 'account_manager_link',
      status: updated.status,
      message: '已关联现有 GPT Account Manager 账号',
      data: { managedAccountEmail: email }
    });
    return updated;
  }

  private async linkImportedSubaccount(
    id: string,
    email: string,
    operationId: string
  ): Promise<SubaccountView> {
    const existing = this.requireSubaccount(id);
    if (existing.email.trim().toLowerCase() !== email) {
      throw new ServiceError(409, 'GAM 导入邮箱与子号邮箱不一致');
    }
    if (existing.managedAccountEmail?.trim().toLowerCase() === email && existing.proxy) return this.detail(id);
    const session = await this.callAccountManager(() => this.accountManager!.session(email));
    const proxy = await this.managedAccountHttpProxy(email);
    const linked = await this.store.saveManagedSubaccount({
      managedAccountEmail: email,
      email: existing.email,
      ...(proxy ? { proxy } : {}),
      session,
      status: existing.status
    });
    await this.store.appendLog(id, {
      phase: 'account_manager_session_import',
      status: linked.status,
      message: 'GAM 已建立浏览器身份归档并完成子号关联',
      data: { managedAccountEmail: email, operationId }
    });
    return linked;
  }

  private async managedAccountHttpProxy(email: string): Promise<string | undefined> {
    if (!this.accountManager?.accountHttpProxy) return undefined;
    return this.callAccountManager(() => this.accountManager!.accountHttpProxy!(email));
  }

  private async removeTerminalEnrollmentOperations(email: string): Promise<void> {
    const operations = await this.callAccountManager(() => this.accountManager!.listOperations({ type: 'import' }));
    for (const operation of operations.filter((item) =>
      accountEnrollmentOperationEmail(item) === email
      && isTerminalAccountEnrollmentOperation(item)
    )) {
      await this.safeRemoveAccountOperation(operation.id);
    }
  }

  async openAccountPro5x(
    id: string,
    input: OpenPro5xRequest
  ): Promise<AccountManagerOperationView> {
    const email = this.requireManagedAccountEmail(id);
    const managed = await this.callAccountManager(() => this.accountManager!.account(email));
    await this.cacheAccountManagerState(id, managed.hasPro5x === true);
    if (managed.hasPro5x) throw new ServiceError(409, '该账号已开通 Pro 5x');
    await this.removeFailedPro5xOperations(email);
    return this.callAccountManager(() => this.accountManager!.openPro5x(email, {
      ...input,
      autoPay: true,
      requestTag: ACCOUNT_MANAGER_REQUEST_TAGS.subaccount
    }));
  }

  async addAccountPersonalPaymentMethod(
    id: string,
    input: AddPersonalPaymentMethodRequest
  ): Promise<AccountManagerOperationView> {
    const email = this.requireManagedAccountEmail(id);
    return this.callAccountManager(() => this.accountManager!.addPersonalPaymentMethod(email, {
      ...input,
      requestTag: ACCOUNT_MANAGER_REQUEST_TAGS.subaccount
    }));
  }

  async accountPersonalPaymentMethodDefaults(id: string): Promise<PersonalPaymentMethodDefaults> {
    const email = this.requireManagedAccountEmail(id);
    return this.callAccountManager(() => this.accountManager!.personalPaymentMethodDefaults(email));
  }

  async personalPaymentMethodOperation(
    id: string,
    operationId: string
  ): Promise<AccountManagerOperationView> {
    const email = this.requireManagedAccountEmail(id);
    const operation = await this.callAccountManager(() => this.accountManager!.operation(operationId));
    if (
      operation.accountId?.toLowerCase() !== email.toLowerCase()
      || operation.type !== 'add_personal_payment_method'
      || operation.requestSummary?.requestTag !== ACCOUNT_MANAGER_REQUEST_TAGS.subaccount
    ) throw new ServiceError(404, `子号个人支付方式操作不存在: ${operationId}`);
    return operation;
  }

  async rotateAccountOperationIp(
    id: string,
    operationId: string
  ): Promise<AccountManagerOperationView> {
    await this.requireSubaccountPro5xOperation(id, operationId);
    return this.callAccountManager(() => this.accountManager!.rotateOperationIp(operationId));
  }

  async retryAccountOperationCurrentStep(
    id: string,
    operationId: string
  ): Promise<AccountManagerOperationView> {
    await this.requireSubaccountPro5xOperation(id, operationId);
    return this.callAccountManager(() => this.accountManager!.retryOperationCurrentStep(operationId));
  }

  async terminateAccountOperation(
    id: string,
    operationId: string
  ): Promise<AccountManagerOperationView> {
    await this.requireSubaccountPro5xOperation(id, operationId);
    return this.callAccountManager(() => this.accountManager!.terminateOperation(operationId));
  }

  async provideAccountPro5xPaymentCard(
    id: string,
    operationId: string,
    input: OpenPro5xRequest
  ): Promise<AccountManagerOperationView> {
    await this.requireSubaccountPro5xOperation(id, operationId);
    return this.callAccountManager(() => this.accountManager!.provideOperationPaymentCard(operationId, {
      ...input,
      autoPay: true
    }));
  }

  async dismissAccountOperation(id: string, operationId: string): Promise<boolean> {
    const operation = await this.requireSubaccountPro5xOperation(id, operationId);
    if (operation.status !== 'failed' && operation.status !== 'interrupted') {
      throw new ServiceError(409, '只有失败或已终止的开通记录可以清除');
    }
    return this.callAccountManager(() => this.accountManager!.removeOperation(operation.id));
  }

  async importSession(raw: unknown): Promise<SubaccountView> {
    const payload = parseSubaccountSessionImportPayload(raw);
    const input = await this.resolveSubaccountSessionInput(payload.session);
    const view = await this.store.importSession(input.session, {
      ...(payload.hasRemark ? { remark: payload.remark } : {}),
      ...(payload.hasGroupName ? { groupName: payload.groupName } : {}),
      ...(payload.hasIsBanned ? { isBanned: payload.isBanned } : {}),
      ...(payload.hasProxy ? { proxy: payload.proxy } : {})
    });
    await this.store.appendLog(view.id, {
      phase: 'session_import',
      status: 'session_ready',
      message: '已录入子号 ChatGPT session JSON',
      data: {
        email: view.email,
        accountIdPresent: Boolean(view.chatgptAccountId),
        localProfilePresent: payload.hasRemark || payload.hasGroupName || payload.hasIsBanned || payload.hasProxy,
        groupName: view.groupName,
        proxyPresent: Boolean(view.proxy),
        inputType: input.type
      }
    });
    return view;
  }

  async removeCodexCredential(id: string, targetChatgptAccountId?: string): Promise<SubaccountView> {
    const subaccount = this.requireSubaccount(id);
    const target = cleanTargetAccountId(targetChatgptAccountId);
    if (!target) throw new ServiceError(400, '缺少 chatgptAccountId');
    const credential = (subaccount.codexCredentials ?? []).find((item) => item.accountId.trim() === target);
    if (!credential) throw new ServiceError(404, '子号还没有该 Team 的 Codex 凭证 JSON');

    const updated = await this.store.removeCodexCredential(id, target);
    if (!updated) throw new ServiceError(404, '子号还没有该 Team 的 Codex 凭证 JSON');
    await this.store.appendLog(id, {
      phase: 'codex_credential_delete',
      status: updated.status,
      message: '已删除该 Team workspace 的 Codex 凭证',
      data: {
        accountId: target,
        fileName: credential.fileName,
        groupName: credential.groupName,
        remainingCredentialCount: updated.codexCredentials.length
      }
    });
    return updated;
  }

  async updateLocalProfile(
    id: string,
    input: { remark?: unknown; groupName?: unknown; isBanned?: unknown; proxy?: unknown; session?: unknown }
  ): Promise<SubaccountView> {
    this.requireSubaccount(id);
    const hasRemark = Object.prototype.hasOwnProperty.call(input, 'remark');
    const hasGroupName = Object.prototype.hasOwnProperty.call(input, 'groupName');
    const hasIsBanned = Object.prototype.hasOwnProperty.call(input, 'isBanned');
    const hasProxy = Object.prototype.hasOwnProperty.call(input, 'proxy');
    if (hasRemark && input.remark !== undefined && typeof input.remark !== 'string') {
      throw new ServiceError(400, '备注必须是字符串');
    }
    if (hasProxy && input.proxy !== undefined && typeof input.proxy !== 'string') {
      throw new ServiceError(400, '代理地址必须是字符串');
    }
    if (hasGroupName && input.groupName !== undefined && typeof input.groupName !== 'string') {
      throw new ServiceError(400, '子号分组必须是字符串');
    }
    if (hasIsBanned && typeof input.isBanned !== 'boolean') {
      throw new ServiceError(400, '封号标记必须是布尔值');
    }
    const remark = typeof input.remark === 'string' ? input.remark.trim() || undefined : undefined;
    const groupName = typeof input.groupName === 'string' ? input.groupName.trim() || '默认分组' : undefined;
    const proxy = typeof input.proxy === 'string' ? input.proxy.trim() || undefined : undefined;

    const sessionInput =
      input.session === undefined
        ? undefined
        : await this.resolveSubaccountSessionInput(input.session);

    const updated = await this.store.updateLocalProfile(id, {
      ...(hasRemark ? { remark } : {}),
      ...(hasGroupName ? { groupName } : {}),
      ...(hasIsBanned ? { isBanned: input.isBanned as boolean } : {}),
      ...(hasProxy ? { proxy } : {}),
      session: sessionInput?.session
    });
    if (!updated) throw new ServiceError(404, `子号不存在: ${id}`);

    await this.store.appendLog(id, {
      phase: 'local_profile_update',
      status: updated.status,
      message: input.session === undefined ? '已更新子号本地资料' : '已更新子号本地资料和 ChatGPT session',
      data: {
        email: updated.email,
        groupName: updated.groupName,
        accountIdPresent: Boolean(updated.chatgptAccountId),
        sessionUpdated: input.session !== undefined,
        proxyUpdated: hasProxy,
        inputType: sessionInput?.type
      }
    });
    return updated;
  }

  async refreshWebAccount(id: string): Promise<SubaccountView> {
    const initial = this.requireSubaccount(id);
    const checkedAt = Date.now();
    const errors: string[] = [];
    let accessToken = initial.webAccessToken?.trim() ?? '';
    let sessionResponse: Record<string, unknown> | undefined;
    let meResponse: Record<string, unknown> | undefined;
    let profileResponse: Record<string, unknown> | undefined;
    let notificationsResponse: Record<string, unknown> | undefined;
    let creditsResponse: Record<string, unknown> | undefined;
    let accountManagerSync: ManagedAccountSummary | undefined;
    let pro5xSubscription: Pro5xSubscriptionView | null | undefined;
    let patch: Partial<Subaccount> = { lastRefreshAt: checkedAt };

    if (!initial.sessionToken?.trim()) {
      errors.push('Session JSON 缺少 sessionToken，无法验证 Session Cookie');
      patch.sessionTokenStatus = 'invalid';
      patch.sessionTokenCheckedAt = checkedAt;
    } else if (!initial.chatgptAccountId?.trim()) {
      errors.push('Session JSON 缺少 account.id，无法刷新 Web Session');
      patch.sessionTokenStatus = 'invalid';
      patch.sessionTokenCheckedAt = checkedAt;
    } else {
      try {
        sessionResponse = await fetchWorkspaceWebSessionFromSessionToken(
          this.webTransport,
          initial.sessionToken,
          initial.chatgptAccountId,
          initial.proxy
        );
        accessToken = readSessionAccessToken(sessionResponse);
        patch = {
          ...patch,
          webAccessToken: accessToken,
          sessionTokenStatus: 'valid',
          sessionTokenCheckedAt: checkedAt
        };
      } catch (error) {
        errors.push(`Session Cookie 验证失败: ${fullErrorMessage(error)}`);
        patch.sessionTokenStatus = 'invalid';
        patch.sessionTokenCheckedAt = checkedAt;
      }
    }

    if (!accessToken || !initial.chatgptAccountId?.trim()) {
      errors.push('缺少可用于 backend-api 的 Web Access Token 或 account.id');
      patch.webAccessTokenStatus = 'invalid';
      patch.webAccessTokenCheckedAt = checkedAt;
    } else {
      const api = this.webApiFor({ ...initial, ...patch, webAccessToken: accessToken }, async (response, token) => {
        sessionResponse = response;
        accessToken = token;
        patch = {
          ...patch,
          webAccessToken: token,
          sessionTokenStatus: 'valid',
          sessionTokenCheckedAt: Date.now()
        };
      });

      let userId = initial.chatgptUserId;
      try {
        meResponse = await api.getMe();
        userId = readOptionalString(meResponse, 'id') ?? userId;
        const remoteEmail = readOptionalString(meResponse, 'email');
        patch = {
          ...patch,
          webAccessToken: accessToken,
          webAccessTokenStatus: 'valid',
          webAccessTokenCheckedAt: Date.now(),
          chatgptUserId: userId,
          remoteDisplayName: readOptionalString(meResponse, 'name') ?? initial.remoteDisplayName,
          remotePictureUrl: readOptionalString(meResponse, 'picture') ?? initial.remotePictureUrl,
          personalProfileCachedAt: Date.now()
        };
        if (remoteEmail && remoteEmail.toLowerCase() !== initial.email.toLowerCase()) {
          errors.push(`个人资料邮箱与子号不一致: ${remoteEmail} != ${initial.email}`);
        }
      } catch (error) {
        errors.push(`个人资料同步失败: ${fullErrorMessage(error)}`);
        if (error instanceof ChatGptApiError && error.status === 401) patch.webAccessTokenStatus = 'invalid';
        patch.webAccessTokenCheckedAt = Date.now();
      }

      if (userId) {
        try {
          profileResponse = await api.getPersonalProfile(userId);
          patch = { ...patch, ...personalProfilePatch(profileResponse, Date.now()) };
        } catch (error) {
          if (!isOptionalPersonalProfileUnavailable(error)) {
            errors.push(`用户名资料读取失败: ${fullErrorMessage(error)}`);
          }
        }
      }

      try {
        notificationsResponse = await api.getNotificationSettings();
        patch = { ...patch, ...marketingNotificationPatch(notificationsResponse, Date.now()) };
      } catch (error) {
        errors.push(`营销通知读取失败: ${fullErrorMessage(error)}`);
      }

      try {
        creditsResponse = await api.getRateLimitResetCredits();
        patch.rateLimitResetCredits = rateLimitResetCreditsFromResponse(creditsResponse, Date.now());
      } catch (error) {
        errors.push(`用量限制读取失败: ${fullErrorMessage(error)}`);
      }
    }

    if (initial.managedAccountEmail?.trim() && this.accountManager) {
      try {
        accountManagerSync = await this.accountManager.syncAccount(initial.managedAccountEmail);
        patch.accountManagerHasPro5x = accountManagerSync.hasPro5x === true;
        patch.accountManagerSyncedAt = Date.now();
      } catch (error) {
        errors.push(`GAM 账号同步失败: ${fullErrorMessage(error)}`);
      }
    }

    if (initial.chatgptAccountId?.trim()) {
      try {
        const current = { ...initial, ...patch };
        pro5xSubscription = await readPro5xSubscription(await this.directPro5xApiFor(current));
        patch.pro5xSubscription = pro5xSubscription ?? undefined;
        patch.pro5xSubscriptionCheckedAt = Date.now();
        if (pro5xSubscription) patch.accountManagerHasPro5x = true;
      } catch (error) {
        errors.push(`Pro 5x 订阅同步失败: ${fullErrorMessage(error)}`);
      }
    }

    if (patch.accountManagerHasPro5x === true) {
      patch.accountManagerPro5xCardLast4 = initial.accountManagerPro5xCardLast4
        ?? await this.historicalPro5xCardLast4(
          initial.managedAccountEmail?.trim() || initial.email
        );
    } else if (patch.accountManagerHasPro5x === false) {
      patch.accountManagerPro5xCardLast4 = undefined;
    }

    patch.lastRefreshAt = Date.now();
    patch.lastError = errors.length ? errors.join('\n') : undefined;
    if ((patch.sessionTokenStatus ?? initial.sessionTokenStatus) === 'valid' && initial.status === 'error') {
      patch.status = initial.codexCredentials?.length ? 'codex_ready' : 'session_ready';
    }
    const updated = await this.store.update(id, patch);
    if (!updated) throw new ServiceError(404, `子号不存在: ${id}`);
    await this.store.appendLog(id, {
      phase: 'web_account_refresh',
      status: errors.length ? 'partial' : 'success',
      message: errors.length ? '子号 Web 账号同步完成，但存在失败步骤' : '子号 Web 账号同步完成',
      data: {
        email: initial.email,
        accountId: initial.chatgptAccountId,
        session: sessionResponse,
        me: meResponse,
        profile: profileResponse,
        notifications: notificationsResponse,
        rateLimitResetCredits: creditsResponse,
        accountManager: accountManagerSync,
        pro5xSubscription,
        errors
      }
    });
    return updated;
  }

  async setMarketingNotifications(
    id: string,
    input: { push?: boolean; email?: boolean }
  ): Promise<SubaccountView> {
    const subaccount = this.requireSubaccount(id);
    const api = this.webApiFor(subaccount);
    try {
      const response = await api.setMarketingNotifications(input);
      const updated = await this.store.update(id, {
        ...marketingNotificationPatch(response, Date.now()),
        webAccessTokenStatus: 'valid',
        webAccessTokenCheckedAt: Date.now(),
        lastError: undefined
      });
      if (!updated) throw new ServiceError(404, `子号不存在: ${id}`);
      await this.store.appendLog(id, {
        phase: 'personal_settings_update',
        status: 'success',
        message: '已修改营销通知设置',
        data: { input, response }
      });
      return updated;
    } catch (error) {
      await this.persistWebRequestError(id, 'personal_settings_update', '修改营销通知设置失败', error, { input });
      throw asServiceError(error);
    }
  }

  async setMemoryEnabled(id: string, enabled: boolean): Promise<SubaccountView> {
    const subaccount = this.requireSubaccount(id);
    const api = this.webApiFor(subaccount);
    try {
      const response = await api.setMemoryEnabled(enabled);
      const remoteValue = response.m3m;
      const updated = await this.store.update(id, {
        memoryEnabled: typeof remoteValue === 'boolean' ? remoteValue : enabled,
        memoryCachedAt: Date.now(),
        webAccessTokenStatus: 'valid',
        webAccessTokenCheckedAt: Date.now(),
        lastError: undefined
      });
      if (!updated) throw new ServiceError(404, `子号不存在: ${id}`);
      await this.store.appendLog(id, {
        phase: 'personal_settings_update',
        status: 'success',
        message: `已${enabled ? '开启' : '关闭'}记忆`,
        data: { enabled, response }
      });
      return updated;
    } catch (error) {
      await this.persistWebRequestError(id, 'personal_settings_update', '修改记忆设置失败', error, { enabled });
      throw asServiceError(error);
    }
  }

  async updatePersonalProfile(
    id: string,
    input: { username?: string; displayName?: string }
  ): Promise<SubaccountView> {
    let subaccount = this.requireSubaccount(id);
    const api = this.webApiFor(subaccount);
    let userId = subaccount.chatgptUserId?.trim();
    const responses: Record<string, unknown> = {};
    try {
      if (!userId) {
        const me = await api.getMe();
        responses.me = me;
        userId = readOptionalString(me, 'id');
        if (!userId) throw new ServiceError(502, '个人资料响应缺少 user id');
        const saved = await this.store.update(id, {
          chatgptUserId: userId,
          remoteDisplayName: readOptionalString(me, 'name'),
          remotePictureUrl: readOptionalString(me, 'picture'),
          personalProfileCachedAt: Date.now()
        });
        if (saved) subaccount = this.requireSubaccount(id);
      }

      let patch: Partial<Subaccount> = {};
      if (input.username !== undefined) {
        const response = await api.setPersonalUsername(userId, input.username);
        responses.username = response;
        patch = { ...patch, ...personalProfilePatch(response, Date.now()) };
      }
      if (input.displayName !== undefined) {
        const response = await api.setPersonalDisplayName(userId, input.displayName);
        responses.displayName = response;
        patch = { ...patch, ...personalProfilePatch(response, Date.now()) };
      }
      const updated = await this.store.update(id, {
        ...patch,
        chatgptUserId: userId,
        webAccessTokenStatus: 'valid',
        webAccessTokenCheckedAt: Date.now(),
        lastError: undefined
      });
      if (!updated) throw new ServiceError(404, `子号不存在: ${id}`);
      await this.store.appendLog(id, {
        phase: 'personal_profile_update',
        status: 'success',
        message: '已修改 ChatGPT 个人资料',
        data: { input, responses }
      });
      return updated;
    } catch (error) {
      await this.persistWebRequestError(id, 'personal_profile_update', '修改 ChatGPT 个人资料失败', error, {
        input,
        responses
      });
      throw asServiceError(error);
    }
  }

  private webApiFor(
    subaccount: Subaccount,
    onSessionRefreshed?: (session: Record<string, unknown>, accessToken: string) => Promise<void> | void
  ): ChatGptApi {
    if (!subaccount.chatgptAccountId?.trim()) throw new ServiceError(400, '子号缺少 ChatGPT account.id');
    if (!subaccount.webAccessToken?.trim()) throw new ServiceError(400, '子号缺少 ChatGPT Web accessToken');
    return new ChatGptApi(
      {
        accountId: subaccount.chatgptAccountId,
        accessToken: subaccount.webAccessToken,
        proxy: subaccount.proxy,
        refreshWebAccessToken: subaccount.sessionToken?.trim()
          ? async () => {
              const session = await fetchWorkspaceWebSessionFromSessionToken(
                this.webTransport,
                subaccount.sessionToken!,
                subaccount.chatgptAccountId!,
                subaccount.proxy
              );
              const accessToken = readSessionAccessToken(session);
              await this.store.update(subaccount.id, {
                webAccessToken: accessToken,
                sessionTokenStatus: 'valid',
                sessionTokenCheckedAt: Date.now()
              });
              await onSessionRefreshed?.(session, accessToken);
              return accessToken;
            }
          : undefined
      },
      this.webTransport
    );
  }

  private async directPro5xApiFor(subaccount: Subaccount): Promise<ChatGptApi> {
    const accountId = subaccount.chatgptAccountId?.trim();
    if (!accountId) throw new ServiceError(400, '子号缺少 ChatGPT account.id');
    const storedCookieSession = subaccount.sessionToken?.trim() && subaccount.webSessionCookies
      ? await fetchWorkspaceWebSessionFromStoredCookies(
          this.webTransport,
          subaccount.sessionToken,
          subaccount.webSessionCookies,
          accountId,
          subaccount.proxy
        )
      : undefined;
    const accessToken = storedCookieSession
      ? readSessionAccessToken(storedCookieSession)
      : await this.resolveWorkspaceWebAccessToken(subaccount, accountId);
    if (accessToken !== subaccount.webAccessToken) {
      await this.store.update(subaccount.id, {
        webAccessToken: accessToken,
        sessionTokenStatus: 'valid',
        sessionTokenCheckedAt: Date.now()
      });
    }
    return new ChatGptApi({ accountId, accessToken, proxy: subaccount.proxy }, this.webTransport);
  }

  private async persistWebRequestError(
    id: string,
    phase: string,
    message: string,
    error: unknown,
    data: Record<string, unknown> = {}
  ): Promise<void> {
    const checkedAt = Date.now();
    const current = this.requireSubaccount(id);
    await this.store.update(id, {
      sessionTokenStatus:
        error instanceof ChatGptWebSessionError ? 'invalid' : current.sessionTokenStatus,
      sessionTokenCheckedAt:
        error instanceof ChatGptWebSessionError ? checkedAt : current.sessionTokenCheckedAt,
      webAccessTokenStatus:
        error instanceof ChatGptApiError && error.status === 401 ? 'invalid' : current.webAccessTokenStatus,
      webAccessTokenCheckedAt: checkedAt,
      lastRefreshAt: checkedAt,
      lastError: fullErrorMessage(error)
    });
    await this.store.appendLog(id, {
      phase,
      status: 'error',
      message,
      data: { ...data, error: fullErrorEvidence(error) }
    });
  }

  async remove(id: string): Promise<boolean> {
    return this.store.remove(id);
  }

  async startCodexAuth(id: string, targetChatgptAccountId?: string): Promise<CodexAuthStart> {
    const subaccount = this.requireSubaccount(id);
    const target = cleanTargetAccountId(targetChatgptAccountId);
    this.pruneExpiredCodexSessions();
    const session = createCodexAuthSession({ loginHint: subaccount.email });
    this.codexSessions.set(session.id, {
      subaccountId: id,
      session,
      targetChatgptAccountId: target
    });
    await this.store.update(id, { status: 'codex_auth_pending', lastError: undefined });
    await this.store.appendLog(id, {
      phase: 'codex_auth_start',
      status: 'codex_auth_pending',
      message: '已创建 Codex OAuth 授权 URL',
      data: {
        sessionId: session.id,
        expiresAt: session.expiresAt,
        targetChatgptAccountId: target
      }
    });
    return {
      sessionId: session.id,
      authUrl: session.authUrl,
      expiresAt: session.expiresAt,
      targetChatgptAccountId: target
    };
  }

  async completeCodexAuth(
    id: string,
    sessionId: string,
    callbackUrl: string
  ): Promise<SubaccountView> {
    const subaccount = this.requireSubaccount(id);
    this.pruneExpiredCodexSessions();
    const entry = this.codexSessions.get(sessionId);
    if (!entry || entry.subaccountId !== id) {
      throw new ServiceError(404, 'Codex OAuth 会话不存在或已过期，请重新生成授权 URL');
    }

    try {
      const credential = await exchangeCodexCallback({
        callbackUrl,
        session: entry.session,
        fetchImpl: this.codexFetch,
        proxy: subaccount.proxy
      });
      assertCredentialMatchesTarget(credential, entry.targetChatgptAccountId);
      const updated = await this.store.saveCodexCredential(id, credential);
      if (!updated) throw new ServiceError(404, `子号不存在: ${id}`);
      this.codexSessions.delete(sessionId);
      await this.store.appendLog(id, {
        phase: 'codex_auth_callback',
        status: 'codex_ready',
        message: 'Codex OAuth 授权完成，已保存凭证 JSON',
        data: {
          email: credential.email,
          accountId: credential.account_id,
          targetChatgptAccountId: entry.targetChatgptAccountId,
          expiresAt: credential.expired
        }
      });
      return updated;
    } catch (error) {
      const message = (error as Error).message;
      await this.store.update(id, { status: 'error', lastError: message });
      await this.store.appendLog(id, {
        phase: 'codex_auth_callback',
        status: 'error',
        message,
        data: { sessionId, targetChatgptAccountId: entry.targetChatgptAccountId }
      });
      if (error instanceof ServiceError) throw error;
      throw new ServiceError(message.startsWith('Codex token exchange') ? 502 : 400, message);
    }
  }

  async createPersonalAccessTokenCredential(
    id: string,
    targetChatgptAccountId?: string
  ): Promise<SubaccountView> {
    const subaccount = this.requireSubaccount(id);
    const target = cleanTargetAccountId(targetChatgptAccountId);
    if (!target) throw new ServiceError(400, '缺少 chatgptAccountId');
    if (!subaccount.webAccessToken?.trim()) {
      throw new ServiceError(400, '子号缺少 ChatGPT Web session，无法创建个人访问令牌');
    }

    await this.store.update(id, { status: 'pat_creating', lastError: undefined });
    await this.store.appendLog(id, {
      phase: 'codex_pat_create_start',
      status: 'pat_creating',
      message: '已开始通过子号 Web session 创建 Codex 个人访问令牌',
      data: { targetChatgptAccountId: target }
    });

    try {
      const webAccessToken = await this.resolveWorkspaceWebAccessToken(subaccount, target);
      const api = new ChatGptApi(
        {
          accountId: target,
          accessToken: webAccessToken,
          proxy: subaccount.proxy
        },
        this.webTransport
      );
      const response = await api.createCodexPersonalAccessToken({
        name: CODEX_PAT_NAME,
        scopes: [CODEX_LOCAL_ACCESS_SCOPE],
        ttl: CODEX_PAT_TTL_SECONDS
      });
      const credential = codexCredentialFromPersonalAccessTokenResponse(response, subaccount.email, target);
      const updated = await this.store.saveCodexCredential(id, credential);
      if (!updated) throw new ServiceError(404, `子号不存在: ${id}`);
      await this.store.appendLog(id, {
        phase: 'codex_pat_create_complete',
        status: 'codex_ready',
        message: '已创建 Codex 个人访问令牌并保存凭证 JSON',
        data: {
          email: credential.email,
          accountId: credential.account_id,
          credentialIdPresent: Boolean(credential.credential_id),
          expiresAt: credential.expired
        }
      });
      return updated;
    } catch (e) {
      const message =
        e instanceof ChatGptApiError
          ? `创建 Codex 个人访问令牌失败: HTTP ${e.status} ${trimForLog(e.body)}`
          : (e as Error).message;
      await this.store.update(id, { status: 'error', lastError: message });
      await this.store.appendLog(id, {
        phase: 'codex_pat_create_complete',
        status: 'error',
        message,
        data: { targetChatgptAccountId: target }
      });
      if (e instanceof ServiceError) throw e;
      if (e instanceof ChatGptApiError) throw new ServiceError(e.status >= 400 && e.status < 500 ? e.status : 502, message);
      throw e;
    }
  }

  private async resolveWorkspaceWebAccessToken(subaccount: Subaccount, target: string): Promise<string> {
    if (subaccount.sessionToken?.trim()) {
      try {
        return await fetchWorkspaceWebAccessTokenFromSessionToken(
          this.webTransport,
          subaccount.sessionToken,
          target,
          subaccount.proxy
        );
      } catch (e) {
        if (e instanceof ChatGptWebSessionError) throw new ServiceError(e.status, e.message);
        throw e;
      }
    }
    if (!subaccount.webAccessToken?.trim()) {
      throw new ServiceError(400, '子号缺少 ChatGPT Web session，无法创建个人访问令牌');
    }
    return subaccount.webAccessToken;
  }

  private pruneExpiredCodexSessions(now = Date.now()): void {
    for (const [sessionId, entry] of this.codexSessions) {
      if (entry.session.expiresAt <= now) this.codexSessions.delete(sessionId);
    }
  }

  private async resolveSubaccountSessionInput(
    raw: unknown
  ): Promise<Awaited<ReturnType<typeof resolveChatGptSessionImportInput>>> {
    try {
      return await resolveChatGptSessionImportInput(raw, this.webTransport);
    } catch (e) {
      if (e instanceof ChatGptWebSessionError) throw new ServiceError(e.status, e.message);
      throw e;
    }
  }

  getCodexCredential(id: string, targetChatgptAccountId?: string): CodexCredentialJson {
    this.requireSubaccount(id);
    const target = cleanTargetAccountId(targetChatgptAccountId);
    const credential = target
      ? this.store.getCodexCredentialForAccount(id, target)
      : this.store.getCodexCredential(id);
    if (!credential) {
      throw new ServiceError(404, target ? '子号还没有该 Team 的 Codex 凭证 JSON' : '子号还没有 Codex 凭证 JSON');
    }
    return credential;
  }

  async refreshQuota(id: string, targetChatgptAccountId?: string): Promise<CodexQuotaSnapshot> {
    const credential = this.getCodexCredential(id, targetChatgptAccountId);
    const subaccount = this.requireSubaccount(id);
    const snapshot = await fetchCodexQuota(credential, this.quotaTransport, subaccount.proxy);
    await this.store.saveQuotaSnapshot(id, credential.account_id, snapshot);
    await this.store.appendLog(id, {
      phase: 'quota_refresh',
      status: snapshot.status,
      message: snapshot.error ?? 'Codex 额度查询完成',
      data: {
        planType: snapshot.planType,
        windowCount: snapshot.windows.length,
        accountId: credential.account_id
      }
    });
    if (snapshot.status === 'error') {
      await this.store.update(id, { status: 'error', lastError: snapshot.error ?? 'Codex 额度查询失败' });
    }
    return snapshot;
  }

  listLogs(id?: string): SubaccountAuthLog[] {
    if (id) this.requireSubaccount(id);
    return this.store.listLogs(id);
  }

  private requireSubaccount(id: string): Subaccount {
    const subaccount = this.store.get(id);
    if (!subaccount) throw new ServiceError(404, `子号不存在: ${id}`);
    return subaccount;
  }

  private requireManagedAccountEmail(id: string): string {
    const subaccount = this.requireSubaccount(id);
    if (!this.accountManager) throw new ServiceError(503, '未配置 GPT Account Manager');
    if (!subaccount.managedAccountEmail) throw new ServiceError(409, '该子号未关联 GPT Account Manager');
    return subaccount.managedAccountEmail;
  }

  private async requireSubaccountPro5xOperation(
    id: string,
    operationId: string
  ): Promise<AccountManagerOperationView> {
    const email = this.requireManagedAccountEmail(id);
    const operation = await this.callAccountManager(() => this.accountManager!.operation(operationId));
    if (
      operation.accountId?.trim().toLowerCase() !== email.trim().toLowerCase()
      || !isSubaccountPro5xOperation(operation)
    ) {
      throw new ServiceError(404, `子号 Pro 5x 开通操作不存在: ${operationId}`);
    }
    return operation;
  }

  private async removeFailedPro5xOperations(email: string): Promise<void> {
    const operations = await this.callAccountManager(() => this.accountManager!.listAccountOperations(email));
    for (const operation of operations.filter((item) =>
      isSubaccountPro5xOperation(item)
      && (item.status === 'failed' || item.status === 'interrupted')
    )) {
      await this.safeRemoveAccountOperation(operation.id);
    }
  }

  private async safeRemoveAccountOperation(operationId: string): Promise<void> {
    try {
      await this.accountManager!.removeOperation(operationId);
    } catch {
      // 账号能力已经同步后，不因远程任务记录清理失败回滚状态。
    }
  }
}

function isSubaccountPro5xOperation(operation: AccountManagerOperationView): boolean {
  return operation.type === 'open_pro_5x'
    && operation.requestSummary?.requestTag === ACCOUNT_MANAGER_REQUEST_TAGS.subaccount;
}

function operationAccountEmail(operation: AccountManagerOperationView): string | undefined {
  const value = operation.accountId || operation.email;
  return value?.trim().toLowerCase() || undefined;
}

function managedSubaccountStatus(
  email: string,
  hasPro5x: boolean,
  pro5xOperation?: AccountManagerOperationView
): SubaccountAccountManagerStatus {
  return {
    configured: true,
    reachable: true,
    managed: true,
    hasPro5x: hasPro5x || pro5xOperation?.status === 'succeeded',
    accountEmail: email,
    ...(pro5xOperation ? { pro5xOperation } : {}),
    ...(pro5xOperation?.errorMessage ? { error: pro5xOperation.errorMessage } : {})
  };
}

function unmanagedSubaccountStatus(
  enrollmentOperation?: AccountManagerOperationView,
  error?: string
): SubaccountAccountManagerStatus {
  return {
    configured: true,
    reachable: true,
    managed: false,
    hasPro5x: false,
    ...(enrollmentOperation ? { enrollmentOperation } : {}),
    error: error
      || enrollmentOperation?.errorMessage
      || enrollmentOperation?.message
      || '该子号未关联 GPT Account Manager'
  };
}

function missingManagedSubaccountStatus(email: string): SubaccountAccountManagerStatus {
  return {
    configured: true,
    reachable: true,
    managed: false,
    hasPro5x: false,
    accountEmail: email,
    error: '该邮箱尚未由 GPT Account Manager 管理'
  };
}

function unreachableManagedSubaccountStatus(
  email: string,
  error: string
): SubaccountAccountManagerStatus {
  return {
    configured: true,
    reachable: false,
    managed: false,
    hasPro5x: false,
    accountEmail: email.trim().toLowerCase(),
    error
  };
}

function parseJsonObject(body: string, message: string): Record<string, unknown> {
  try {
    const data = JSON.parse(body) as unknown;
    return data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {};
  } catch {
    throw new ServiceError(502, message);
  }
}

function cleanTargetAccountId(value?: string): string | undefined {
  const target = value?.trim();
  return target || undefined;
}

function assertCredentialMatchesTarget(credential: CodexCredentialJson, target?: string): void {
  if (!target) return;
  if (credential.account_id !== target) {
    throw new ServiceError(
      409,
      `Codex OAuth 选择的 workspace 与目标不一致：目标 ${target}，实际 ${credential.account_id || '空'}`
    );
  }
}

function parseSubaccountSessionImportPayload(raw: unknown): {
  session: unknown;
  remark?: string;
  groupName?: string;
  isBanned?: boolean;
  proxy?: string;
  hasRemark: boolean;
  hasGroupName: boolean;
  hasIsBanned: boolean;
  hasProxy: boolean;
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { session: raw, hasRemark: false, hasGroupName: false, hasIsBanned: false, hasProxy: false };
  }

  const record = raw as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(record, 'session')) {
    return { session: raw, hasRemark: false, hasGroupName: false, hasIsBanned: false, hasProxy: false };
  }

  const hasRemark = Object.prototype.hasOwnProperty.call(record, 'remark');
  const hasGroupName = Object.prototype.hasOwnProperty.call(record, 'groupName');
  const hasIsBanned = Object.prototype.hasOwnProperty.call(record, 'isBanned');
  const hasProxy = Object.prototype.hasOwnProperty.call(record, 'proxy');
  if (hasRemark && record.remark !== undefined && typeof record.remark !== 'string') {
    throw new ServiceError(400, '备注必须是字符串');
  }
  if (hasProxy && record.proxy !== undefined && typeof record.proxy !== 'string') {
    throw new ServiceError(400, '代理地址必须是字符串');
  }
  if (hasGroupName && record.groupName !== undefined && typeof record.groupName !== 'string') {
    throw new ServiceError(400, '子号分组必须是字符串');
  }
  if (hasIsBanned && typeof record.isBanned !== 'boolean') {
    throw new ServiceError(400, '封号标记必须是布尔值');
  }
  if (record.session === undefined) throw new ServiceError(400, '缺少 session JSON');

  return {
    session: record.session,
    ...(hasRemark ? { remark: (record.remark as string | undefined)?.trim() || undefined } : {}),
    ...(hasGroupName ? { groupName: (record.groupName as string | undefined)?.trim() || '默认分组' } : {}),
    ...(hasIsBanned ? { isBanned: record.isBanned as boolean } : {}),
    ...(hasProxy ? { proxy: (record.proxy as string | undefined)?.trim() || undefined } : {}),
    hasRemark,
    hasGroupName,
    hasIsBanned,
    hasProxy
  };
}

function cleanOptionalString(value?: string): string | undefined {
  const cleaned = value?.trim();
  return cleaned || undefined;
}

function normalizeSubaccountRegistrationGroupName(value: unknown): string {
  if (value !== undefined && typeof value !== 'string') {
    throw new ServiceError(400, '子号分组必须是字符串');
  }
  return typeof value === 'string' ? value.trim() || '默认分组' : '默认分组';
}

function normalizeSubaccountRegistrationCountry(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^[A-Z]{2}$/u.test(value.trim().toUpperCase())) {
    throw new ServiceError(400, '注册国家必须是两位国家代码');
  }
  return value.trim().toUpperCase();
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function personalProfilePatch(response: Record<string, unknown>, cachedAt: number): Partial<Subaccount> {
  return {
    chatgptUserId: readOptionalString(response, 'user_id'),
    remoteUsername: readOptionalString(response, 'username'),
    remoteDisplayName: readOptionalString(response, 'display_name'),
    remotePictureUrl: readOptionalString(response, 'profile_picture_url'),
    personalProfileCachedAt: cachedAt
  };
}

function marketingNotificationPatch(response: Record<string, unknown>, cachedAt: number): Partial<Subaccount> {
  const settings = Array.isArray(response.settings) ? response.settings : [];
  const marketing = settings.find(
    (item) => item && typeof item === 'object' && (item as Record<string, unknown>).category === 'marketing'
  ) as Record<string, unknown> | undefined;
  const options = Array.isArray(marketing?.options) ? marketing.options : [];
  const enabledFor = (channel: string): boolean | undefined => {
    const option = options.find(
      (item) => item && typeof item === 'object' && (item as Record<string, unknown>).channel === channel
    ) as Record<string, unknown> | undefined;
    return typeof option?.enabled === 'boolean' ? option.enabled : undefined;
  };
  return {
    marketingPushEnabled: enabledFor('push'),
    marketingEmailEnabled: enabledFor('email'),
    marketingNotificationsCachedAt: cachedAt
  };
}

function rateLimitResetCreditsFromResponse(
  response: Record<string, unknown>,
  cachedAt: number
): NonNullable<Subaccount['rateLimitResetCredits']> {
  return {
    credits: Array.isArray(response.credits) ? response.credits : [],
    availableCount: typeof response.available_count === 'number' ? response.available_count : 0,
    totalEarnedCount: typeof response.total_earned_count === 'number' ? response.total_earned_count : 0,
    cachedAt
  };
}

function readSessionAccessToken(session: Record<string, unknown>): string {
  const accessToken = readOptionalString(session, 'accessToken');
  if (!accessToken) throw new ServiceError(502, 'ChatGPT Web Session 响应缺少 accessToken');
  return accessToken;
}

function fullErrorEvidence(error: unknown): Record<string, unknown> {
  if (error instanceof ChatGptApiError) {
    return {
      name: error.name,
      message: error.message,
      status: error.status,
      context: error.context,
      body: error.body
    };
  }
  if (error instanceof ChatGptWebSessionError || error instanceof ServiceError) {
    return {
      name: error.name,
      message: error.message,
      status: error.status
    };
  }
  return {
    name: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : String(error)
  };
}

function fullErrorMessage(error: unknown): string {
  if (error instanceof ChatGptApiError) {
    return `${error.context} HTTP ${error.status}: ${error.body}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function asServiceError(error: unknown): ServiceError {
  if (error instanceof ServiceError) return error;
  if (error instanceof Pro5xSubscriptionError) {
    return new ServiceError(upstreamServiceStatus(error.status), error.message);
  }
  if (error instanceof ChatGptWebSessionError) {
    return new ServiceError(upstreamServiceStatus(error.status), fullErrorMessage(error));
  }
  if (error instanceof ChatGptApiError) {
    return new ServiceError(upstreamServiceStatus(error.status), fullErrorMessage(error));
  }
  return new ServiceError(502, fullErrorMessage(error));
}

function upstreamServiceStatus(status: number): number {
  if (status === 401) return 502;
  return status >= 400 && status < 500 ? status : 502;
}

function isOptionalPersonalProfileUnavailable(error: unknown): boolean {
  if (!(error instanceof ChatGptApiError) || error.status !== 401) return false;
  try {
    const payload = JSON.parse(error.body) as { error?: { code?: unknown; message?: unknown } };
    return payload.error?.code === 'no_organization'
      || (typeof payload.error?.message === 'string'
        && /must be a member of an organization/i.test(payload.error.message));
  } catch {
    return /no_organization|must be a member of an organization/i.test(error.body);
  }
}

function codexCredentialFromPersonalAccessTokenResponse(
  response: CodexPersonalAccessTokenResponse,
  fallbackEmail: string,
  targetAccountId?: string,
  now: Date = new Date()
): CodexPersonalAccessTokenCredentialJson {
  const accessToken = response.access_token?.trim();
  if (!accessToken) throw new ServiceError(502, '个人访问令牌响应缺少 access_token');
  const issuedAccountId = response.workspace_id?.trim();
  if (!issuedAccountId) throw new ServiceError(502, '个人访问令牌响应缺少 workspace_id');
  const target = targetAccountId?.trim();
  if (target && issuedAccountId !== target) {
    throw new ServiceError(
      409,
      `个人访问令牌 workspace 与目标不一致：目标 ${target}，实际 ${issuedAccountId}`
    );
  }
  const accountId = issuedAccountId;
  const email = response.creator_user_email?.trim() || fallbackEmail;
  const lastRefresh = epochSecondsToIso(response.created_at) ?? now.toISOString();
  const expired = epochSecondsToIso(response.expires_at);
  if (!expired) throw new ServiceError(502, '个人访问令牌响应缺少 expires_at');

  return {
    access_token: accessToken,
    personal_access_token: accessToken,
    account_id: accountId,
    last_refresh: lastRefresh,
    email,
    type: 'codex',
    expired,
    auth_mode: 'personalAccessToken',
    credential_source: 'personal_access_token',
    credential_id: response.credential_id,
    chatgpt_user_id: response.owner_user_id
  };
}

function epochSecondsToIso(value: unknown): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function trimForLog(value: string): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length > 200 ? `${trimmed.slice(0, 200)}...` : trimmed;
}
