import type {
  AccountManagerOperationView,
  AccountManagerProfileView,
  AccountManagerRuntimeStatus,
  AccountSummaryView,
  AccountView,
  OpenCodexSpaceRequest,
  OpenPro5xRequest,
  OpenTeamSubscriptionRequest,
  ParentAccountManagerStatus,
  ParentRegistrationTaskView,
  Pro5xPaymentStatisticsView,
  ResidentialProxyConfig
} from '@team-manager/shared';
import { accountSummaryFromView } from '@team-manager/shared';
import { AccountStore } from './accountStore.js';
import {
  ACCOUNT_MANAGER_REQUEST_TAGS,
  AccountManagerError,
  type AccountManagerGateway,
  type ManagedAccountSummary
} from './accountManagerClient.js';
import { ServiceError, TeamService } from './teamService.js';
import { accountManagerProfilesByLocalId } from './accountManagerProfiles.js';
import {
  accountEnrollmentOperationEmail,
  findLatestAccountEnrollmentOperation,
  isAccountEnrollmentOperation,
  isTerminalAccountEnrollmentOperation
} from './accountManagerEnrollment.js';
import {
  normalizePro5xCardLast4,
  pro5xOperationCardLast4,
  successfulPro5xCardLast4ByAccount
} from './pro5xPaymentCard.js';

const TEAM_PLAN = 'team';
const CODEX_SPACE_PLAN = 'self_serve_business_usage_based';

export class ParentAccountManagerService {
  constructor(
    private readonly store: AccountStore,
    private readonly teamService: TeamService,
    private readonly accountManager?: AccountManagerGateway
  ) {}

  async runtimeStatus(): Promise<AccountManagerRuntimeStatus> {
    if (!this.accountManager) {
      return { configured: false, reachable: false, error: '未配置 GPT Account Manager' };
    }
    try {
      const health = await this.accountManager.health();
      return {
        configured: health.accountRegistrationConfigured === true,
        reachable: health.status === 'ok',
        ...(health.accountRegistrationConfigured === true
          ? {}
          : { error: 'GPT Account Manager 注册环境未配置完整' })
      };
    } catch (error) {
      return {
        configured: true,
        reachable: false,
        error: error instanceof AccountManagerError ? error.message : (error as Error).message
      };
    }
  }

  async pro5xPaymentStatistics(): Promise<Pro5xPaymentStatisticsView> {
    if (!this.accountManager) throw new ServiceError(503, '未配置 GPT Account Manager');
    return this.callAccountManager(() => this.accountManager!.pro5xPaymentStatistics());
  }

  async listRegistrationTasks(): Promise<ParentRegistrationTaskView[]> {
    if (!this.accountManager) return [];
    const operations = await this.callAccountManager(() => this.accountManager!.listOperations({
      type: 'register',
      requestTag: ACCOUNT_MANAGER_REQUEST_TAGS.parent
    }));
    const tasks: ParentRegistrationTaskView[] = [];
    for (const operation of operations) tasks.push(await this.reconcileRegistration(operation));
    return tasks;
  }

  async startRegistration(groupName?: unknown): Promise<AccountManagerOperationView> {
    if (!this.accountManager) throw new ServiceError(503, '未配置 GPT Account Manager');
    const targetGroup = normalizeRegistrationGroupName(groupName);
    const job = await this.callAccountManager(() => this.accountManager!.startRegistration({
      requestTag: ACCOUNT_MANAGER_REQUEST_TAGS.parent,
      clientReference: targetGroup
    }));
    return this.callAccountManager(() => this.accountManager!.operation(job.id));
  }

  async retryRegistration(operationId: string): Promise<AccountManagerOperationView> {
    const operation = await this.requireParentRegistration(operationId);
    await this.callAccountManager(() => this.accountManager!.retryRegistration(operation.id));
    return this.callAccountManager(() => this.accountManager!.operation(operation.id));
  }

  async rotateRegistrationIp(operationId: string): Promise<ParentRegistrationTaskView> {
    const operation = await this.requireParentRegistration(operationId);
    if (operation.status !== 'waiting_manual') {
      throw new ServiceError(409, '只有等待人工处理的母号注册任务可以更换IP');
    }
    return this.reconcileRegistration(
      await this.callAccountManager(() => this.accountManager!.rotateOperationIp(operation.id))
    );
  }

  async registrationProxyConfig(operationId: string): Promise<ResidentialProxyConfig> {
    const operation = await this.requireParentRegistration(operationId);
    return this.callAccountManager(() => this.accountManager!.operationProxyConfig(operation.id));
  }

  async configureRegistrationProxy(
    operationId: string,
    input: ResidentialProxyConfig
  ): Promise<ResidentialProxyConfig> {
    const operation = await this.requireParentRegistration(operationId);
    return this.callAccountManager(() => this.accountManager!.configureOperationProxy(operation.id, input));
  }

  async accountStatus(accountId: string): Promise<ParentAccountManagerStatus> {
    const local = this.store.get(accountId);
    if (!local) throw new ServiceError(404, `母号不存在: ${accountId}`);
    const localHasCodexSpace = local.planType === CODEX_SPACE_PLAN;
    const localHasTeamSubscription = this.teamService.hasTeamSubscription(local.id);
    if (!this.accountManager) {
      return {
        configured: false,
        reachable: false,
        managed: false,
        hasCodexSpace: localHasCodexSpace,
        hasTeamSubscription: localHasTeamSubscription,
        error: '未配置 GPT Account Manager'
      };
    }
    if (!local.managedAccountEmail) {
      try {
        const operations = await this.accountManager.listOperations({ type: 'import' });
        return this.reconcileAccountEnrollment(
          accountId,
          local.email,
          findLatestAccountEnrollmentOperation(operations, local.email),
          localHasTeamSubscription,
          localHasCodexSpace
        );
      } catch (error) {
        return {
          configured: true,
          reachable: false,
          managed: false,
          hasCodexSpace: localHasCodexSpace,
          hasTeamSubscription: localHasTeamSubscription,
          accountEmail: local.email.trim().toLowerCase(),
          error: error instanceof AccountManagerError ? error.message : (error as Error).message
        };
      }
    }

    const email = local.managedAccountEmail;
    try {
      let managed = await this.accountManager.account(email);
      const operations = (await this.accountManager.listAccountOperations(email))
        .filter(isParentWorkspacePurchaseOperation)
        .sort((a, b) => b.createdAt - a.createdAt);
      let codexOperation = operations.find(isParentCodexOperation);
      let teamOperation = operations.find(isParentTeamOperation);
      let pro5xOperation = operations.find(isParentPro5xOperation);
      const operationCardLast4 = pro5xOperationCardLast4(pro5xOperation);
      let importedAccounts: AccountSummaryView[] = [];

      if (teamOperation?.status === 'succeeded') {
        importedAccounts = await this.importTeamOperationWorkspaces(email, teamOperation);
        await this.safeRemoveOperation(teamOperation.id);
        teamOperation = undefined;
        managed = await this.accountManager.account(email);
      }
      const localAlreadyUsesManagedTeam = localHasTeamSubscription
        && managed.workspaces.some((workspace) => workspace.visible && workspace.id === local.accountId);
      if (managed.hasTeamSubscription && importedAccounts.length === 0 && !localAlreadyUsesManagedTeam) {
        const imported = await this.importManagedTeamWorkspaces(email, managed);
        importedAccounts = mergeAccounts(importedAccounts, imported);
      }
      if (codexOperation?.status === 'succeeded' && managed.hasCodexSpace) {
        await this.safeRemoveOperation(codexOperation.id);
        codexOperation = undefined;
      }
      if (pro5xOperation?.status === 'succeeded' && managed.hasPro5x) {
        await this.safeRemoveOperation(pro5xOperation.id);
        pro5xOperation = undefined;
      }

      const hasPro5x = managed.hasPro5x === true || pro5xOperation?.status === 'succeeded';
      const cardLast4 = hasPro5x && !operationCardLast4 && !local.accountManagerPro5xCardLast4
        ? await this.historicalPro5xCardLast4(email)
        : operationCardLast4;
      await this.cacheAccountManagerState(accountId, hasPro5x, { cardLast4 });

      return managedParentStatus(
        email,
        managed,
        [codexOperation, teamOperation, pro5xOperation].filter(
          (operation): operation is AccountManagerOperationView => Boolean(operation)
        ),
        importedAccounts,
        localHasTeamSubscription,
        localHasCodexSpace
      );
    } catch (error) {
      if (error instanceof AccountManagerError && error.status === 404) {
        return {
          configured: true,
          reachable: true,
          managed: false,
          hasCodexSpace: localHasCodexSpace,
          hasTeamSubscription: localHasTeamSubscription,
          accountEmail: email,
          error: '该邮箱尚未由 GPT Account Manager 管理'
        };
      }
      return {
        configured: true,
        reachable: false,
        managed: false,
        hasCodexSpace: localHasCodexSpace,
        hasTeamSubscription: localHasTeamSubscription,
        accountEmail: email,
        error: error instanceof AccountManagerError ? error.message : (error as Error).message
      };
    }
  }

  async accountStatuses(): Promise<Record<string, ParentAccountManagerStatus>> {
    const accounts = this.store.list();
    if (!this.accountManager?.listAccounts) {
      const entries = await Promise.all(accounts.map(async (account) => [
        account.id,
        await this.accountStatus(account.id)
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
      for (const operation of allOperations.filter(isParentWorkspacePurchaseOperation)) {
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

      const needsPaymentHistory = accounts.some((local) => {
        const email = local.managedAccountEmail?.trim().toLowerCase();
        const managed = email ? managedByEmail.get(email) : undefined;
        if (!email || !managed) return false;
        const pro5xOperation = (operationsByEmail.get(email) ?? [])
          .sort((left, right) => right.createdAt - left.createdAt)
          .find(isParentPro5xOperation);
        const hasPro5x = managed.hasPro5x === true || pro5xOperation?.status === 'succeeded';
        return hasPro5x
          && !local.accountManagerPro5xCardLast4
          && !pro5xOperationCardLast4(pro5xOperation);
      });
      const historicalCardLast4ByAccount = needsPaymentHistory
        ? await this.historicalPro5xCardLast4ByAccount()
        : new Map<string, string>();

      for (const local of accounts) {
        const email = local.managedAccountEmail?.trim().toLowerCase();
        const managed = email ? managedByEmail.get(email) : undefined;
        if (managed) {
          const pro5xOperation = (operationsByEmail.get(email!) ?? [])
            .sort((left, right) => right.createdAt - left.createdAt)
            .find(isParentPro5xOperation);
          await this.cacheAccountManagerState(
            local.id,
            managed.hasPro5x === true || pro5xOperation?.status === 'succeeded',
            {
              cardLast4: pro5xOperationCardLast4(pro5xOperation)
                ?? historicalCardLast4ByAccount.get(email!),
              refreshTimestamp: false
            }
          );
        }
      }

      const entries = await Promise.all(accounts.map(async (local) => {
        const localHasCodexSpace = local.planType === CODEX_SPACE_PLAN;
        const localHasTeamSubscription = this.teamService.hasTeamSubscription(local.id);
        const email = local.managedAccountEmail?.trim().toLowerCase();
        if (!email) {
          const localEmail = local.email.trim().toLowerCase();
          const enrollmentOperation = (enrollmentOperationsByEmail.get(localEmail) ?? [])
            .sort((a, b) => b.createdAt - a.createdAt)[0];
          if (enrollmentOperation?.status === 'succeeded' && managedByEmail.has(localEmail)) {
            const linkedAccount = await this.linkLocalAccount(local.id, localEmail);
            await this.removeTerminalEnrollmentOperations(localEmail);
            return [
              local.id,
              appendImportedAccount(await this.accountStatus(local.id), linkedAccount)
            ] as const;
          }
          return [
            local.id,
            unmanagedLocalParentStatus(
              localHasTeamSubscription,
              localHasCodexSpace,
              enrollmentOperation,
              enrollmentOperation?.status === 'succeeded'
                ? 'GAM 导入已完成，但账号状态尚未可读取，正在等待同步'
                : undefined
            )
          ] as const;
        }
        const managed = managedByEmail.get(email);
        if (!managed) {
          return [
            local.id,
            missingManagedParentStatus(email, localHasTeamSubscription, localHasCodexSpace)
          ] as const;
        }
        const operations = (operationsByEmail.get(email) ?? []).sort((a, b) => b.createdAt - a.createdAt);
        const codexOperation = operations.find(isParentCodexOperation);
        const teamOperation = operations.find(isParentTeamOperation);
        const pro5xOperation = operations.find(isParentPro5xOperation);
        const localAlreadyUsesManagedTeam = localHasTeamSubscription
          && managed.workspaces.some((workspace) => workspace.visible && workspace.id === local.accountId);
        const needsReconciliation = teamOperation?.status === 'succeeded'
          || (codexOperation?.status === 'succeeded' && managed.hasCodexSpace)
          || (pro5xOperation?.status === 'succeeded' && managed.hasPro5x)
          || (managed.hasTeamSubscription && !localAlreadyUsesManagedTeam);
        return [
          local.id,
          needsReconciliation
            ? await this.accountStatus(local.id)
            : managedParentStatus(
              email,
              managed,
              operations,
              [],
              localHasTeamSubscription,
              localHasCodexSpace
            )
        ] as const;
      }));
      return Object.fromEntries(entries);
    } catch (error) {
      const message = error instanceof AccountManagerError ? error.message : (error as Error).message;
      return Object.fromEntries(accounts.map((account) => [
        account.id,
        account.managedAccountEmail
          ? unreachableManagedParentStatus(
            account.managedAccountEmail,
            message,
            this.teamService.hasTeamSubscription(account.id),
            account.planType === CODEX_SPACE_PLAN
          )
          : unmanagedLocalParentStatus(
            this.teamService.hasTeamSubscription(account.id),
            account.planType === CODEX_SPACE_PLAN
          )
      ]));
    }
  }

  async startAccountManagement(accountId: string): Promise<ParentAccountManagerStatus> {
    const local = this.store.get(accountId);
    if (!local) throw new ServiceError(404, `母号不存在: ${accountId}`);
    if (!this.accountManager) throw new ServiceError(503, '未配置 GPT Account Manager');
    if (local.managedAccountEmail) return this.accountStatus(accountId);

    const email = local.email.trim().toLowerCase();
    if (!email) throw new ServiceError(400, '母号邮箱不能为空');
    const localHasCodexSpace = local.planType === CODEX_SPACE_PLAN;
    const localHasTeamSubscription = this.teamService.hasTeamSubscription(local.id);
    const managed = await this.findManagedAccount(email);
    if (managed) {
      const linkedAccount = await this.linkLocalAccount(local.id, email);
      await this.removeTerminalEnrollmentOperations(email);
      return appendImportedAccount(await this.accountStatus(local.id), linkedAccount);
    }

    const operations = await this.callAccountManager(() => this.accountManager!.listOperations({ type: 'import' }));
    const existing = findLatestAccountEnrollmentOperation(operations, email);
    if (existing && existing.status !== 'failed' && existing.status !== 'interrupted') {
      return this.reconcileAccountEnrollment(
        local.id,
        email,
        existing,
        localHasTeamSubscription,
        localHasCodexSpace
      );
    }
    for (const operation of operations.filter((item) =>
      accountEnrollmentOperationEmail(item) === email
      && (item.status === 'failed' || item.status === 'interrupted')
    )) {
      await this.safeRemoveOperation(operation.id);
    }

    const operation = await this.callAccountManager(() => this.accountManager!.startAccountImport({
      email,
      authMethod: local.sessionToken ? 'existing_session' : 'email_otp',
      ...(local.sessionToken
        ? {
            session: {
              user: { email: local.email },
              account: { id: local.accountId },
              accessToken: local.accessToken,
              sessionToken: local.sessionToken
            }
          }
        : {})
    }));
    return unmanagedLocalParentStatus(
      localHasTeamSubscription,
      localHasCodexSpace,
      operation
    );
  }

  async refreshAccount(accountId: string): Promise<AccountView> {
    const local = this.store.get(accountId);
    if (!local) throw new ServiceError(404, `母号不存在: ${accountId}`);
    const managedSync = local.managedAccountEmail && this.accountManager
      ? this.syncManagedAccountIfIdle(local.managedAccountEmail).catch(() => undefined)
      : Promise.resolve(undefined);
    const [refreshed, managed] = await Promise.all([
      this.teamService.refreshAccount(accountId),
      managedSync
    ]);
    if (!managed) return refreshed;
    const cardLast4 = managed.hasPro5x && !local.accountManagerPro5xCardLast4
      ? await this.historicalPro5xCardLast4(managed.email)
      : undefined;
    await this.cacheAccountManagerState(accountId, managed.hasPro5x === true, { cardLast4 });
    const cached = this.store.get(accountId);
    return {
      ...refreshed,
      accountManagerHasPro5x: cached?.accountManagerHasPro5x,
      accountManagerPro5xCardLast4: cached?.accountManagerPro5xCardLast4,
      accountManagerSyncedAt: cached?.accountManagerSyncedAt
    };
  }

  private async reconcileAccountEnrollment(
    accountId: string,
    email: string,
    operation: AccountManagerOperationView | undefined,
    localHasTeamSubscription: boolean,
    localHasCodexSpace: boolean
  ): Promise<ParentAccountManagerStatus> {
    if (operation?.status !== 'succeeded') {
      return unmanagedLocalParentStatus(
        localHasTeamSubscription,
        localHasCodexSpace,
        operation
      );
    }
    const managed = await this.findManagedAccount(email);
    if (!managed) {
      return unmanagedLocalParentStatus(
        localHasTeamSubscription,
        localHasCodexSpace,
        operation,
        'GAM 导入已完成，但账号状态尚未可读取，正在等待同步'
      );
    }
    const linkedAccount = await this.linkLocalAccount(accountId, email);
    await this.removeTerminalEnrollmentOperations(email);
    return appendImportedAccount(await this.accountStatus(accountId), linkedAccount);
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

  private async linkLocalAccount(accountId: string, email: string): Promise<AccountSummaryView> {
    const updated = await this.store.update(accountId, { managedAccountEmail: email });
    if (!updated) throw new ServiceError(404, `母号不存在: ${accountId}`);
    return accountSummaryFromView(await this.teamService.getAccountDetail(accountId));
  }

  private async removeTerminalEnrollmentOperations(email: string): Promise<void> {
    const operations = await this.callAccountManager(() => this.accountManager!.listOperations({ type: 'import' }));
    for (const operation of operations.filter((item) =>
      accountEnrollmentOperationEmail(item) === email
      && isTerminalAccountEnrollmentOperation(item)
    )) {
      await this.safeRemoveOperation(operation.id);
    }
  }

  async accountProfile(accountId: string): Promise<AccountManagerProfileView> {
    const email = this.requireManagedAccountEmail(accountId);
    return this.callAccountManager(() => this.accountManager!.accountProfile(email));
  }

  async accountProfiles(): Promise<Record<string, AccountManagerProfileView>> {
    return this.callAccountManager(() => accountManagerProfilesByLocalId(
      this.accountManager,
      this.store.list()
    ));
  }

  async startAccountProfile(accountId: string): Promise<AccountManagerProfileView> {
    const email = this.requireManagedAccountEmail(accountId);
    return this.callAccountManager(() => this.accountManager!.startAccountProfile(email));
  }

  async stopAccountProfile(accountId: string): Promise<AccountManagerProfileView> {
    const email = this.requireManagedAccountEmail(accountId);
    return this.callAccountManager(() => this.accountManager!.stopAccountProfile(email));
  }

  async accountProxyConfig(accountId: string): Promise<ResidentialProxyConfig> {
    const email = this.requireManagedAccountEmail(accountId);
    return this.callAccountManager(() => this.accountManager!.accountProxyConfig(email));
  }

  async configureAccountProxy(
    accountId: string,
    input: ResidentialProxyConfig
  ): Promise<ResidentialProxyConfig> {
    const email = this.requireManagedAccountEmail(accountId);
    return this.callAccountManager(() => this.accountManager!.configureAccountProxy(email, input));
  }

  async openAccountCodexSpace(
    accountId: string,
    input: OpenCodexSpaceRequest
  ): Promise<AccountManagerOperationView> {
    const local = this.store.get(accountId);
    if (!local) throw new ServiceError(404, `母号不存在: ${accountId}`);
    if (!this.accountManager) throw new ServiceError(503, '未配置 GPT Account Manager');
    if (!local.managedAccountEmail) throw new ServiceError(409, '该母号未关联 GPT Account Manager');
    if (local.planType === CODEX_SPACE_PLAN) throw new ServiceError(409, '该账号已开通 0.52 Codex 空间');
    const email = local.managedAccountEmail;
    const managed = await this.callAccountManager(() => this.accountManager!.account(email));
    if (managed.hasCodexSpace) throw new ServiceError(409, '该账号已开通 0.52 Codex 空间');
    await this.removeFailedCodexOperations(email);
    return this.callAccountManager(() => this.accountManager!.openCodexSpace(email, {
      ...input,
      requestTag: ACCOUNT_MANAGER_REQUEST_TAGS.parent
    }));
  }

  async openAccountTeamSubscription(
    accountId: string,
    input: OpenTeamSubscriptionRequest
  ): Promise<AccountManagerOperationView> {
    const local = this.store.get(accountId);
    if (!local) throw new ServiceError(404, `母号不存在: ${accountId}`);
    if (!this.accountManager) throw new ServiceError(503, '未配置 GPT Account Manager');
    if (!local.managedAccountEmail) throw new ServiceError(409, '该母号未关联 GPT Account Manager');
    const email = local.managedAccountEmail;
    const managed = await this.callAccountManager(() => this.accountManager!.account(email));
    if (managed.hasTeamSubscription || this.teamService.hasTeamSubscription(local.id)) {
      throw new ServiceError(409, '该账号已开通双席位 Team');
    }
    await this.removeFailedOperations(email, isParentTeamOperation);
    return this.callAccountManager(() => this.accountManager!.openTeamSubscription(email, {
      ...input,
      requestTag: ACCOUNT_MANAGER_REQUEST_TAGS.parent
    }));
  }

  async openAccountPro5x(
    accountId: string,
    input: OpenPro5xRequest
  ): Promise<AccountManagerOperationView> {
    const local = this.store.get(accountId);
    if (!local) throw new ServiceError(404, `母号不存在: ${accountId}`);
    if (!this.accountManager) throw new ServiceError(503, '未配置 GPT Account Manager');
    if (!local.managedAccountEmail) throw new ServiceError(409, '该母号未关联 GPT Account Manager');
    const email = local.managedAccountEmail;
    const managed = await this.callAccountManager(() => this.accountManager!.account(email));
    await this.cacheAccountManagerState(accountId, managed.hasPro5x === true);
    if (managed.hasPro5x) throw new ServiceError(409, '该账号已开通 Pro 5x');
    await this.removeFailedOperations(email, isParentPro5xOperation);
    return this.callAccountManager(() => this.accountManager!.openPro5x(email, {
      ...input,
      autoPay: true,
      requestTag: ACCOUNT_MANAGER_REQUEST_TAGS.parent
    }));
  }

  async rotateAccountOperationIp(
    accountId: string,
    operationId: string
  ): Promise<AccountManagerOperationView> {
    await this.requireParentWorkspacePurchase(accountId, operationId);
    return this.callAccountManager(() => this.accountManager!.rotateOperationIp(operationId));
  }

  async retryAccountOperationCurrentStep(
    accountId: string,
    operationId: string
  ): Promise<AccountManagerOperationView> {
    const operation = await this.requireParentWorkspacePurchase(accountId, operationId);
    if (operation.type !== 'open_pro_5x') throw new ServiceError(409, '该操作不是 Pro 5x 开通任务');
    return this.callAccountManager(() => this.accountManager!.retryOperationCurrentStep(operationId));
  }

  async terminateAccountOperation(
    accountId: string,
    operationId: string
  ): Promise<AccountManagerOperationView> {
    await this.requireParentWorkspacePurchase(accountId, operationId);
    return this.callAccountManager(() => this.accountManager!.terminateOperation(operationId));
  }

  async provideAccountPro5xPaymentCard(
    accountId: string,
    operationId: string,
    input: OpenPro5xRequest
  ): Promise<AccountManagerOperationView> {
    const operation = await this.requireParentWorkspacePurchase(accountId, operationId);
    if (operation.type !== 'open_pro_5x') throw new ServiceError(409, '该操作不是 Pro 5x 开通任务');
    return this.callAccountManager(() => this.accountManager!.provideOperationPaymentCard(operationId, {
      ...input,
      autoPay: true
    }));
  }

  async dismissAccountOperation(accountId: string, operationId: string): Promise<boolean> {
    const operation = await this.requireParentWorkspacePurchase(accountId, operationId);
    if (operation.status !== 'failed' && operation.status !== 'interrupted') {
      throw new ServiceError(409, '只有失败或已终止的开通记录可以清除');
    }
    return this.callAccountManager(() => this.accountManager!.removeOperation(operation.id));
  }

  private async reconcileRegistration(
    registration: AccountManagerOperationView
  ): Promise<ParentRegistrationTaskView> {
    const email = registrationEmail(registration);
    if (registration.status === 'queued' || registration.status === 'running') {
      return { registration, stage: 'registering', ...(email ? { email } : {}) };
    }
    if (registration.status === 'waiting_manual') {
      return { registration, stage: 'waiting_manual', ...(email ? { email } : {}) };
    }
    if (registration.status === 'failed' || registration.status === 'interrupted') {
      return {
        registration,
        stage: 'registration_failed',
        ...(email ? { email } : {}),
        error: registration.errorMessage || registration.message
      };
    }
    if (registration.status !== 'succeeded' || !email) {
      return { registration, stage: 'import_failed', error: '注册操作缺少可交付的邮箱账号' };
    }

    try {
      const session = await this.accountManager!.session(email);
      const parent = accountSummaryFromView(
        await this.teamService.saveManagedParentIdentityFromSessionInput(
          email,
          session,
          registrationGroupName(registration)
        )
      );
      await this.safeRemoveOperation(registration.id);
      return { registration, stage: 'completed', email, parent };
    } catch (error) {
      return {
        registration,
        stage: 'import_failed',
        email,
        error: error instanceof AccountManagerError ? error.message : (error as Error).message
      };
    }
  }

  private async importManagedTeamWorkspaces(
    email: string,
    managed: ManagedAccountSummary
  ) {
    const workspaceIds = managed.workspaces
      .filter((workspace) => workspace.visible && workspace.structure === 'workspace' && workspace.planType === TEAM_PLAN)
      .map((workspace) => workspace.id);
    return this.importWorkspaces(email, workspaceIds);
  }

  private async importTeamOperationWorkspaces(email: string, operation: AccountManagerOperationView) {
    const workspaceIds = operationWorkspaceIds(operation);
    if (!workspaceIds.length) {
      const managed = await this.accountManager!.account(email);
      return this.importManagedTeamWorkspaces(email, managed);
    }
    return this.importWorkspaces(email, workspaceIds);
  }

  private async importWorkspaces(email: string, workspaceIds: string[]) {
    if (!workspaceIds.length) throw new ServiceError(409, 'Account Manager 未返回可导入的 Team workspace');
    const session = await this.accountManager!.session(email);
    const imported = [];
    for (const workspaceId of workspaceIds) {
      imported.push(accountSummaryFromView(
        await this.teamService.saveManagedAccountFromSessionInput(email, { session }, workspaceId)
      ));
    }
    return imported;
  }

  private async requireParentRegistration(operationId: string): Promise<AccountManagerOperationView> {
    if (!this.accountManager) throw new ServiceError(503, '未配置 GPT Account Manager');
    const operation = await this.callAccountManager(() => this.accountManager!.operation(operationId));
    if (
      operation.type !== 'register' ||
      operation.requestSummary?.requestTag !== ACCOUNT_MANAGER_REQUEST_TAGS.parent
    ) {
      throw new ServiceError(404, `母号注册操作不存在: ${operationId}`);
    }
    return operation;
  }

  private requireManagedAccountEmail(accountId: string): string {
    const local = this.store.get(accountId);
    if (!local) throw new ServiceError(404, `母号不存在: ${accountId}`);
    if (!this.accountManager) throw new ServiceError(503, '未配置 GPT Account Manager');
    if (!local.managedAccountEmail) throw new ServiceError(409, '该母号未关联 GPT Account Manager');
    return local.managedAccountEmail;
  }

  private async requireParentWorkspacePurchase(
    accountId: string,
    operationId: string
  ): Promise<AccountManagerOperationView> {
    const local = this.store.get(accountId);
    if (!local) throw new ServiceError(404, `母号不存在: ${accountId}`);
    if (!this.accountManager) throw new ServiceError(503, '未配置 GPT Account Manager');
    if (!local.managedAccountEmail) throw new ServiceError(409, '该母号未关联 GPT Account Manager');
    const operation = await this.callAccountManager(() => this.accountManager!.operation(operationId));
    if (
      operation.accountId?.toLowerCase() !== local.managedAccountEmail.toLowerCase()
      || !isParentWorkspacePurchaseOperation(operation)
    ) {
      throw new ServiceError(404, `母号开通操作不存在: ${operationId}`);
    }
    return operation;
  }

  private async removeFailedCodexOperations(email: string): Promise<void> {
    return this.removeFailedOperations(email, isParentCodexOperation);
  }

  private async cacheAccountManagerState(
    accountId: string,
    hasPro5x: boolean,
    options: { cardLast4?: string; refreshTimestamp?: boolean } = {}
  ): Promise<void> {
    const current = this.store.get(accountId);
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
    await this.store.update(accountId, {
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

  private async syncManagedAccountIfIdle(email: string): Promise<ManagedAccountSummary | undefined> {
    const operations = await this.accountManager!.listAccountOperations(email);
    const hasActiveWorkspacePurchase = operations.some((operation) =>
      isParentWorkspacePurchaseOperation(operation)
      && ['queued', 'running', 'waiting_for_otp', 'waiting_manual'].includes(operation.status)
    );
    if (hasActiveWorkspacePurchase) return undefined;
    return this.accountManager!.syncAccount(email);
  }

  private async removeFailedOperations(
    email: string,
    predicate: (operation: AccountManagerOperationView) => boolean
  ): Promise<void> {
    const operations = await this.callAccountManager(() => this.accountManager!.listAccountOperations(email));
    for (const operation of operations.filter((item) =>
      predicate(item) && (item.status === 'failed' || item.status === 'interrupted')
    )) {
      await this.safeRemoveOperation(operation.id);
    }
  }

  private async safeRemoveOperation(operationId: string): Promise<void> {
    try {
      await this.accountManager!.removeOperation(operationId);
    } catch {
      // 已完成的业务导入不因远程清理失败回滚。
    }
  }

  private async callAccountManager<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof AccountManagerError) throw new ServiceError(error.status, error.message);
      throw error;
    }
  }
}

function normalizeRegistrationGroupName(value: unknown): string {
  if (value !== undefined && typeof value !== 'string') {
    throw new ServiceError(400, '母号分组必须是字符串');
  }
  return typeof value === 'string' ? value.trim() || '默认分组' : '默认分组';
}

function registrationGroupName(operation: AccountManagerOperationView): string {
  const value = operation.requestSummary?.clientReference;
  return typeof value === 'string' ? value.trim() || '默认分组' : '默认分组';
}

function managedParentStatus(
  email: string,
  managed: ManagedAccountSummary,
  operations: AccountManagerOperationView[],
  importedAccounts: AccountSummaryView[] = [],
  localHasTeamSubscription = false,
  localHasCodexSpace = false
): ParentAccountManagerStatus {
  const codexOperation = operations.find(isParentCodexOperation);
  const teamOperation = operations.find(isParentTeamOperation);
  const pro5xOperation = operations.find(isParentPro5xOperation);
  return {
    configured: true,
    reachable: true,
    managed: true,
    hasCodexSpace: localHasCodexSpace || managed.hasCodexSpace || codexOperation?.status === 'succeeded',
    hasTeamSubscription: managed.hasTeamSubscription || localHasTeamSubscription,
    hasPro5x: managed.hasPro5x === true || pro5xOperation?.status === 'succeeded',
    accountEmail: email,
    teamUpgradeWorkspaces: managed.workspaces
      .filter((workspace) => workspace.visible
        && workspace.structure === 'workspace'
        && workspace.planType !== TEAM_PLAN)
      .map((workspace) => ({
        id: workspace.id,
        ...(workspace.name ? { name: workspace.name } : {}),
        planType: workspace.planType,
        isDeactivated: workspace.isDeactivated === true
      })),
    ...(codexOperation ? { codexOperation } : {}),
    ...(teamOperation ? { teamOperation } : {}),
    ...(pro5xOperation ? { pro5xOperation } : {}),
    ...(importedAccounts.length ? { importedAccounts } : {}),
    ...(pro5xOperation?.errorMessage || teamOperation?.errorMessage || codexOperation?.errorMessage
      ? { error: pro5xOperation?.errorMessage || teamOperation?.errorMessage || codexOperation?.errorMessage }
      : {})
  };
}

function unmanagedLocalParentStatus(
  hasTeamSubscription: boolean,
  hasCodexSpace = false,
  enrollmentOperation?: AccountManagerOperationView,
  error?: string
): ParentAccountManagerStatus {
  return {
    configured: true,
    reachable: true,
    managed: false,
    hasCodexSpace,
    hasTeamSubscription,
    ...(enrollmentOperation ? { enrollmentOperation } : {}),
    error: error
      || enrollmentOperation?.errorMessage
      || enrollmentOperation?.message
      || '该母号未关联 GPT Account Manager'
  };
}

function missingManagedParentStatus(
  email: string,
  hasTeamSubscription: boolean,
  hasCodexSpace = false
): ParentAccountManagerStatus {
  return {
    configured: true,
    reachable: true,
    managed: false,
    hasCodexSpace,
    hasTeamSubscription,
    accountEmail: email,
    error: '该邮箱尚未由 GPT Account Manager 管理'
  };
}

function unreachableManagedParentStatus(
  email: string,
  error: string,
  hasTeamSubscription: boolean,
  hasCodexSpace = false
): ParentAccountManagerStatus {
  return {
    configured: true,
    reachable: false,
    managed: false,
    hasCodexSpace,
    hasTeamSubscription,
    accountEmail: email.trim().toLowerCase(),
    error
  };
}

function operationAccountEmail(operation: AccountManagerOperationView): string | undefined {
  const email = operation.accountId || operation.email;
  return email?.trim().toLowerCase() || undefined;
}

function registrationEmail(operation: AccountManagerOperationView): string | undefined {
  const value = operation.accountId || operation.email;
  return value?.trim().toLowerCase() || undefined;
}

function isParentCodexOperation(operation: AccountManagerOperationView): boolean {
  return operation.type === 'open_codex_space'
    && operation.requestSummary?.requestTag === ACCOUNT_MANAGER_REQUEST_TAGS.parent;
}

function isParentTeamOperation(operation: AccountManagerOperationView): boolean {
  return operation.type === 'open_team_subscription'
    && operation.requestSummary?.requestTag === ACCOUNT_MANAGER_REQUEST_TAGS.parent;
}

function isParentPro5xOperation(operation: AccountManagerOperationView): boolean {
  return operation.type === 'open_pro_5x'
    && operation.requestSummary?.requestTag === ACCOUNT_MANAGER_REQUEST_TAGS.parent;
}

function isParentWorkspacePurchaseOperation(operation: AccountManagerOperationView): boolean {
  return isParentCodexOperation(operation)
    || isParentTeamOperation(operation)
    || isParentPro5xOperation(operation);
}

function operationWorkspaceIds(operation: AccountManagerOperationView): string[] {
  const workspaces = operation.result?.workspaces;
  if (!Array.isArray(workspaces)) return [];
  return workspaces
    .map((workspace) => workspace && typeof workspace === 'object' ? (workspace as Record<string, unknown>).id : undefined)
    .filter((id): id is string => typeof id === 'string' && Boolean(id.trim()));
}

function mergeAccounts<T extends { id: string }>(current: T[], next: T[]): T[] {
  const byId = new Map(current.map((account) => [account.id, account]));
  for (const account of next) byId.set(account.id, account);
  return [...byId.values()];
}

function appendImportedAccount(
  status: ParentAccountManagerStatus,
  account: AccountSummaryView
): ParentAccountManagerStatus {
  return {
    ...status,
    importedAccounts: mergeAccounts(status.importedAccounts ?? [], [account])
  };
}
