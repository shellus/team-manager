import type {
  Account,
  AccountManagerOperationView,
  AccountManagerRuntimeStatus,
  AccountSummaryView,
  OpenCodexSpaceRequest,
  OpenTeamSubscriptionRequest,
  ParentAccountManagerStatus,
  ParentRegistrationTaskView
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

const TEAM_PLAN = 'team';

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

  async startRegistration(): Promise<AccountManagerOperationView> {
    if (!this.accountManager) throw new ServiceError(503, '未配置 GPT Account Manager');
    const job = await this.callAccountManager(() => this.accountManager!.startRegistration({
      requestTag: ACCOUNT_MANAGER_REQUEST_TAGS.parent
    }));
    return this.callAccountManager(() => this.accountManager!.operation(job.id));
  }

  async retryRegistration(operationId: string): Promise<AccountManagerOperationView> {
    const operation = await this.requireParentRegistration(operationId);
    await this.callAccountManager(() => this.accountManager!.retryRegistration(operation.id));
    return this.callAccountManager(() => this.accountManager!.operation(operation.id));
  }

  async accountStatus(accountId: string): Promise<ParentAccountManagerStatus> {
    const local = this.store.get(accountId);
    if (!local) throw new ServiceError(404, `母号不存在: ${accountId}`);
    if (!this.accountManager) {
      return {
        configured: false,
        reachable: false,
        managed: false,
        hasCodexSpace: false,
        hasTeamSubscription: local.planType === TEAM_PLAN,
        error: '未配置 GPT Account Manager'
      };
    }
    if (!local.managedAccountEmail) {
      return {
        configured: true,
        reachable: true,
        managed: false,
        hasCodexSpace: false,
        hasTeamSubscription: local.planType === TEAM_PLAN,
        error: '该母号未关联 GPT Account Manager'
      };
    }

    const email = local.managedAccountEmail;
    try {
      let managed = await this.accountManager.account(email);
      const operations = (await this.accountManager.listAccountOperations(email))
        .filter(isParentWorkspacePurchaseOperation)
        .sort((a, b) => b.createdAt - a.createdAt);
      let codexOperation = operations.find(isParentCodexOperation);
      let teamOperation = operations.find(isParentTeamOperation);
      let importedAccounts: AccountSummaryView[] = [];

      if (teamOperation?.status === 'succeeded') {
        importedAccounts = await this.importTeamOperationWorkspaces(email, teamOperation);
        await this.safeRemoveOperation(teamOperation.id);
        teamOperation = undefined;
        managed = await this.accountManager.account(email);
      }
      const localAlreadyUsesManagedTeam = local.planType === TEAM_PLAN
        && managed.workspaces.some((workspace) => workspace.visible && workspace.id === local.accountId);
      if (managed.hasTeamSubscription && importedAccounts.length === 0 && !localAlreadyUsesManagedTeam) {
        const imported = await this.importManagedTeamWorkspaces(email, managed);
        importedAccounts = mergeAccounts(importedAccounts, imported);
      }
      if (codexOperation?.status === 'succeeded' && managed.hasCodexSpace) {
        await this.safeRemoveOperation(codexOperation.id);
        codexOperation = undefined;
      }

      return managedParentStatus(
        email,
        managed,
        [codexOperation, teamOperation].filter(
          (operation): operation is AccountManagerOperationView => Boolean(operation)
        ),
        importedAccounts
      );
    } catch (error) {
      if (error instanceof AccountManagerError && error.status === 404) {
        return {
          configured: true,
          reachable: true,
          managed: false,
          hasCodexSpace: false,
          hasTeamSubscription: local.planType === TEAM_PLAN,
          accountEmail: email,
          error: '该邮箱尚未由 GPT Account Manager 管理'
        };
      }
      return {
        configured: true,
        reachable: false,
        managed: false,
        hasCodexSpace: false,
        hasTeamSubscription: local.planType === TEAM_PLAN,
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

      const entries = await Promise.all(accounts.map(async (local) => {
        const email = local.managedAccountEmail?.trim().toLowerCase();
        if (!email) return [local.id, unmanagedLocalParentStatus(local)] as const;
        const managed = managedByEmail.get(email);
        if (!managed) return [local.id, missingManagedParentStatus(local, email)] as const;
        const operations = (operationsByEmail.get(email) ?? []).sort((a, b) => b.createdAt - a.createdAt);
        const codexOperation = operations.find(isParentCodexOperation);
        const teamOperation = operations.find(isParentTeamOperation);
        const localAlreadyUsesManagedTeam = local.planType === TEAM_PLAN
          && managed.workspaces.some((workspace) => workspace.visible && workspace.id === local.accountId);
        const needsReconciliation = teamOperation?.status === 'succeeded'
          || (codexOperation?.status === 'succeeded' && managed.hasCodexSpace)
          || (managed.hasTeamSubscription && !localAlreadyUsesManagedTeam);
        return [
          local.id,
          needsReconciliation
            ? await this.accountStatus(local.id)
            : managedParentStatus(email, managed, operations)
        ] as const;
      }));
      return Object.fromEntries(entries);
    } catch (error) {
      const message = error instanceof AccountManagerError ? error.message : (error as Error).message;
      return Object.fromEntries(accounts.map((account) => [
        account.id,
        account.managedAccountEmail
          ? unreachableManagedParentStatus(account, account.managedAccountEmail, message)
          : unmanagedLocalParentStatus(account)
      ]));
    }
  }

  async openAccountCodexSpace(
    accountId: string,
    input: OpenCodexSpaceRequest
  ): Promise<AccountManagerOperationView> {
    const local = this.store.get(accountId);
    if (!local) throw new ServiceError(404, `母号不存在: ${accountId}`);
    if (!this.accountManager) throw new ServiceError(503, '未配置 GPT Account Manager');
    if (!local.managedAccountEmail) throw new ServiceError(409, '该母号未关联 GPT Account Manager');
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
    if (managed.hasTeamSubscription) throw new ServiceError(409, '该账号已开通双席位 Team');
    await this.removeFailedOperations(email, isParentTeamOperation);
    return this.callAccountManager(() => this.accountManager!.openTeamSubscription(email, {
      ...input,
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

  async terminateAccountOperation(
    accountId: string,
    operationId: string
  ): Promise<AccountManagerOperationView> {
    await this.requireParentWorkspacePurchase(accountId, operationId);
    return this.callAccountManager(() => this.accountManager!.terminateOperation(operationId));
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
        await this.teamService.saveManagedParentIdentityFromSessionInput(email, session)
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

function managedParentStatus(
  email: string,
  managed: ManagedAccountSummary,
  operations: AccountManagerOperationView[],
  importedAccounts: AccountSummaryView[] = []
): ParentAccountManagerStatus {
  const codexOperation = operations.find(isParentCodexOperation);
  const teamOperation = operations.find(isParentTeamOperation);
  return {
    configured: true,
    reachable: true,
    managed: true,
    hasCodexSpace: managed.hasCodexSpace,
    hasTeamSubscription: managed.hasTeamSubscription,
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
    ...(importedAccounts.length ? { importedAccounts } : {}),
    ...(teamOperation?.errorMessage || codexOperation?.errorMessage
      ? { error: teamOperation?.errorMessage || codexOperation?.errorMessage }
      : {})
  };
}

function unmanagedLocalParentStatus(local: Account): ParentAccountManagerStatus {
  return {
    configured: true,
    reachable: true,
    managed: false,
    hasCodexSpace: false,
    hasTeamSubscription: local.planType === TEAM_PLAN,
    error: '该母号未关联 GPT Account Manager'
  };
}

function missingManagedParentStatus(local: Account, email: string): ParentAccountManagerStatus {
  return {
    configured: true,
    reachable: true,
    managed: false,
    hasCodexSpace: false,
    hasTeamSubscription: local.planType === TEAM_PLAN,
    accountEmail: email,
    error: '该邮箱尚未由 GPT Account Manager 管理'
  };
}

function unreachableManagedParentStatus(
  local: Account,
  email: string,
  error: string
): ParentAccountManagerStatus {
  return {
    configured: true,
    reachable: false,
    managed: false,
    hasCodexSpace: false,
    hasTeamSubscription: local.planType === TEAM_PLAN,
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

function isParentWorkspacePurchaseOperation(operation: AccountManagerOperationView): boolean {
  return isParentCodexOperation(operation) || isParentTeamOperation(operation);
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
