import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type {
  AccountManagerOperationView,
  AccountView,
  OpenCodexSpaceRequest,
  OpenTeamSubscriptionRequest,
  SubaccountRegistrationJobView
} from '@team-manager/shared';
import { AccountStore } from './accountStore.js';
import {
  ACCOUNT_MANAGER_REQUEST_TAGS,
  AccountManagerError,
  type AccountManagerGateway,
  type AccountManagerOperationFilter,
  type AccountRegistrationRequest,
  type ManagedAccountSummary
} from './accountManagerClient.js';
import { ParentAccountManagerService } from './parentAccountManagerService.js';
import type { TeamService } from './teamService.js';

class FakeAccountManager implements AccountManagerGateway {
  operations: AccountManagerOperationView[] = [];
  accounts = new Map<string, ManagedAccountSummary>();
  opened?: { accountId: string; input: OpenCodexSpaceRequest & { requestTag?: string } };
  openedTeam?: { accountId: string; input: OpenTeamSubscriptionRequest & { requestTag?: string } };
  controls: string[] = [];
  listAccountsCalls = 0;
  accountCalls = 0;
  listAccountOperationsCalls = 0;

  async health() { return { status: 'ok', accountRegistrationConfigured: true }; }

  async listAccounts() {
    this.listAccountsCalls += 1;
    return [...this.accounts.values()];
  }

  async listOperations(filter: AccountManagerOperationFilter = {}) {
    return this.operations.filter((operation) =>
      (!filter.type || operation.type === filter.type)
      && (!filter.status || operation.status === filter.status)
      && (!filter.requestTag || operation.requestSummary?.requestTag === filter.requestTag)
    );
  }

  async operation(id: string) {
    const operation = this.operations.find((item) => item.id === id);
    if (!operation) throw new AccountManagerError(404, 'operation missing');
    return operation;
  }

  async listAccountOperations(accountId: string) {
    this.listAccountOperationsCalls += 1;
    return this.operations.filter((operation) => operation.accountId === accountId);
  }

  async listRegistrations(requestTag?: string): Promise<SubaccountRegistrationJobView[]> {
    return (await this.listOperations({ type: 'register', requestTag })).map((operation) => ({
      id: operation.id,
      status: operation.status === 'waiting_for_otp' ? 'running' : operation.status,
      phase: operation.phase,
      message: operation.message || operation.phase,
      progress: operation.progress,
      email: operation.accountId,
      createdAt: operation.createdAt,
      updatedAt: operation.updatedAt
    }));
  }

  async startRegistration(input: AccountRegistrationRequest): Promise<SubaccountRegistrationJobView> {
    const operation: AccountManagerOperationView = {
      id: 'registration-1',
      type: 'register',
      status: 'queued',
      phase: 'registration_queued',
      message: '已加入注册队列',
      progress: 0,
      requestSummary: { requestTag: input.requestTag },
      createdAt: 1,
      updatedAt: 1
    };
    this.operations.push(operation);
    return {
      id: operation.id,
      status: 'queued',
      phase: operation.phase,
      message: operation.message!,
      progress: 0,
      createdAt: 1,
      updatedAt: 1
    };
  }

  async retryRegistration(id: string): Promise<SubaccountRegistrationJobView> {
    const operation = await this.operation(id);
    operation.status = 'queued';
    operation.progress = 0;
    return {
      id,
      status: 'queued',
      phase: operation.phase,
      message: operation.message || operation.phase,
      progress: 0,
      createdAt: operation.createdAt,
      updatedAt: operation.updatedAt
    };
  }

  async rotateOperationIp(id: string) {
    const operation = await this.operation(id);
    this.controls.push(`rotate:${id}`);
    operation.phase = 'proxy_rotation_requested';
    operation.message = '已请求更换IP';
    return operation;
  }

  async terminateOperation(id: string) {
    const operation = await this.operation(id);
    this.controls.push(`terminate:${id}`);
    operation.status = 'interrupted';
    operation.phase = 'operation_terminated';
    operation.errorCode = 'operation_terminated_by_user';
    return operation;
  }

  async removeOperation(id: string) {
    const before = this.operations.length;
    this.operations = this.operations.filter((operation) => operation.id !== id);
    return before !== this.operations.length;
  }

  async account(accountId: string) {
    this.accountCalls += 1;
    const account = this.accounts.get(accountId);
    if (!account) throw new AccountManagerError(404, 'account missing');
    return account;
  }

  async session(accountId: string) {
    return {
      user: { email: accountId },
      account: { id: 'personal-account' },
      accessToken: 'web-access-token',
      sessionToken: 'session-token'
    };
  }

  async openCodexSpace(accountId: string, input: OpenCodexSpaceRequest & { requestTag?: string }) {
    this.opened = { accountId, input };
    const operation: AccountManagerOperationView = {
      id: `codex-${this.operations.length}`,
      accountId,
      type: 'open_codex_space',
      status: 'queued',
      phase: 'codex_queued',
      progress: 0,
      requestSummary: { requestTag: input.requestTag, cardLast4: input.card.number.slice(-4) },
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.operations.push(operation);
    return operation;
  }

  async openTeamSubscription(accountId: string, input: OpenTeamSubscriptionRequest & { requestTag?: string }) {
    this.openedTeam = { accountId, input };
    const operation: AccountManagerOperationView = {
      id: `team-${this.operations.length}`,
      accountId,
      type: 'open_team_subscription',
      status: 'queued',
      phase: 'team_subscription_queued',
      progress: 0,
      requestSummary: { requestTag: input.requestTag, country: input.country, currency: input.currency },
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.operations.push(operation);
    return operation;
  }

  completeRegistration(email: string) {
    const operation = this.operations.find((item) => item.type === 'register')!;
    operation.status = 'succeeded';
    operation.accountId = email;
    operation.email = email;
    operation.progress = 100;
    this.accounts.set(email, {
      id: email, email, hasCodexSpace: false, hasTeamSubscription: false, workspaces: []
    });
  }

  completeCodex(email: string, workspaceId: string) {
    const operation = this.operations.find((item) => item.type === 'open_codex_space')!;
    operation.status = 'succeeded';
    operation.progress = 100;
    operation.result = { workspaces: [{ id: workspaceId }] };
    this.accounts.set(email, {
      id: email,
      email,
      hasCodexSpace: true,
      hasTeamSubscription: false,
      workspaces: [{ id: workspaceId, structure: 'workspace', planType: 'self_serve_business_usage_based', visible: true }]
    });
  }

  completeTeam(email: string, workspaceId: string) {
    const operation = this.operations.find((item) => item.type === 'open_team_subscription')!;
    operation.status = 'succeeded';
    operation.progress = 100;
    operation.result = { workspaces: [{ id: workspaceId }] };
    const existing = this.accounts.get(email)!;
    this.accounts.set(email, {
      ...existing,
      hasTeamSubscription: true,
      workspaces: existing.workspaces.some((workspace) => workspace.id === workspaceId)
        ? existing.workspaces.map((workspace) => workspace.id === workspaceId
          ? { ...workspace, planType: 'team' }
          : workspace)
        : [
            ...existing.workspaces,
            { id: workspaceId, structure: 'workspace', planType: 'team', visible: true }
          ]
    });
  }
}

class FakeTeamService {
  saved: Array<{ kind: 'identity' | 'workspace'; email: string; preferredAccountId?: string }> = [];

  async saveManagedParentIdentityFromSessionInput(email: string): Promise<AccountView> {
    this.saved.push({ kind: 'identity', email });
    return {
      id: 'parent-personal',
      managedAccountEmail: email,
      groupName: '默认分组',
      limitType: 'unknown',
      accountId: 'personal-account',
      email,
      status: 'unknown',
      hasTeamSubscription: false,
      canManageWorkspace: false
    };
  }

  async saveManagedAccountFromSessionInput(email: string, _raw: unknown, preferredAccountId?: string): Promise<AccountView> {
    this.saved.push({ kind: 'workspace', email, preferredAccountId });
    return {
      id: `parent-${preferredAccountId}`,
      managedAccountEmail: email,
      groupName: '默认分组',
      limitType: 'unknown',
      accountId: preferredAccountId!,
      email,
      status: 'unknown',
      hasTeamSubscription: true,
      canManageWorkspace: true
    };
  }
}

async function withService(run: (
  service: ParentAccountManagerService,
  accountManager: FakeAccountManager,
  teamService: FakeTeamService,
  store: AccountStore
) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'parent-account-manager-'));
  const store = new AccountStore(dir);
  await store.init();
  const accountManager = new FakeAccountManager();
  const teamService = new FakeTeamService();
  try {
    await run(
      new ParentAccountManagerService(store, teamService as unknown as TeamService, accountManager),
      accountManager,
      teamService,
      store
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('ParentAccountManagerService', () => {
  it('finishes parent registration immediately without requiring 0.52', async () => {
    await withService(async (service, accountManager, teamService) => {
      const started = await service.startRegistration();
      assert.equal(started.requestSummary?.requestTag, ACCOUNT_MANAGER_REQUEST_TAGS.parent);

      accountManager.completeRegistration('parent@example.com');
      const completed = await service.listRegistrationTasks();
      assert.equal(completed[0]!.stage, 'completed');
      assert.equal(completed[0]!.parent?.accountId, 'personal-account');
      assert.deepEqual(teamService.saved, [{ kind: 'identity', email: 'parent@example.com' }]);
      assert.equal(accountManager.operations.length, 0);
    });
  });

  it('opens 0.52 for a managed parent using the same parent request tag', async () => {
    await withService(async (service, accountManager, _teamService, store) => {
      const parent = await store.add({
        managedAccountEmail: 'owner@example.com',
        accountId: 'team-workspace',
        email: 'owner@example.com',
        accessToken: 'web-access-token'
      });
      accountManager.accounts.set('owner@example.com', {
        id: 'owner@example.com', email: 'owner@example.com', hasCodexSpace: false,
        hasTeamSubscription: false, workspaces: []
      });

      await service.openAccountCodexSpace(parent.id, {
        country: 'IT',
        currency: 'EUR',
        credits: 16,
        card: { number: '4000000000000002', expiryMonth: 8, expiryYear: 2029, cvc: '456' }
      });

      assert.equal(accountManager.opened?.accountId, 'owner@example.com');
      assert.equal(accountManager.opened?.input.requestTag, ACCOUNT_MANAGER_REQUEST_TAGS.parent);
    });
  });

  it('loads parent list GAM statuses with one account batch instead of per-parent requests', async () => {
    await withService(async (service, accountManager, _teamService, store) => {
      const parent = await store.add({
        managedAccountEmail: 'owner@example.com',
        accountId: 'personal-account',
        email: 'owner@example.com',
        accessToken: 'web-access-token',
        planType: 'free'
      });
      await store.add({
        accountId: 'manual-workspace',
        email: 'manual@example.com',
        accessToken: 'manual-token'
      });
      accountManager.accounts.set('owner@example.com', {
        id: 'owner@example.com',
        email: 'owner@example.com',
        hasCodexSpace: false,
        hasTeamSubscription: false,
        workspaces: []
      });
      accountManager.operations.push({
        id: 'codex-running',
        accountId: 'owner@example.com',
        type: 'open_codex_space',
        status: 'running',
        phase: 'payment_processing',
        progress: 60,
        requestSummary: { requestTag: ACCOUNT_MANAGER_REQUEST_TAGS.parent },
        createdAt: 1,
        updatedAt: 1
      });

      const statuses = await service.accountStatuses();

      assert.equal(statuses[parent.id]!.codexOperation?.id, 'codex-running');
      assert.equal(accountManager.listAccountsCalls, 1);
      assert.equal(accountManager.accountCalls, 0);
      assert.equal(accountManager.listAccountOperationsCalls, 0);
    });
  });

  it('opens a two-seat Team order with an optional saved Stripe card and imports the Team workspace', async () => {
    await withService(async (service, accountManager, teamService, store) => {
      const parent = await store.add({
        managedAccountEmail: 'owner@example.com',
        accountId: 'personal-account',
        email: 'owner@example.com',
        accessToken: 'web-access-token',
        planType: 'free'
      });
      accountManager.accounts.set('owner@example.com', {
        id: 'owner@example.com', email: 'owner@example.com', hasCodexSpace: true,
        hasTeamSubscription: false,
        workspaces: [{
          id: 'codex-workspace', name: 'Morgan Inc', structure: 'workspace',
          planType: 'self_serve_business_usage_based', isDeactivated: false, visible: true
        }]
      });

      const beforeOpen = await service.accountStatus(parent.id);
      assert.deepEqual(beforeOpen.teamUpgradeWorkspaces, [{
        id: 'codex-workspace',
        name: 'Morgan Inc',
        planType: 'self_serve_business_usage_based',
        isDeactivated: false
      }]);

      await service.openAccountTeamSubscription(parent.id, {
        workspaceId: 'codex-workspace',
        promoCode: 'PROMO', country: 'GB', currency: 'GBP', autoPay: false
      });
      assert.equal(accountManager.openedTeam?.accountId, 'owner@example.com');
      assert.equal(accountManager.openedTeam?.input.card, undefined);
      assert.equal(accountManager.openedTeam?.input.workspaceId, 'codex-workspace');
      assert.equal(accountManager.openedTeam?.input.autoPay, false);
      assert.equal(accountManager.openedTeam?.input.requestTag, ACCOUNT_MANAGER_REQUEST_TAGS.parent);

      accountManager.completeTeam('owner@example.com', 'codex-workspace');
      const status = await service.accountStatus(parent.id);
      assert.equal(status.hasCodexSpace, true);
      assert.equal(status.hasTeamSubscription, true);
      assert.deepEqual(teamService.saved, [{
        kind: 'workspace', email: 'owner@example.com', preferredAccountId: 'codex-workspace'
      }]);
    });
  });

  it('does not infer an Account Manager link from an unmanaged parent email', async () => {
    await withService(async (service, accountManager, _teamService, store) => {
      const parent = await store.add({
        accountId: 'manual-workspace',
        email: 'manual@example.com',
        accessToken: 'web-access-token'
      });
      accountManager.accounts.set('manual@example.com', {
        id: 'manual@example.com', email: 'manual@example.com', hasCodexSpace: false,
        hasTeamSubscription: false, workspaces: []
      });

      const status = await service.accountStatus(parent.id);
      assert.equal(status.managed, false);
      assert.equal(status.error, '该母号未关联 GPT Account Manager');
      await assert.rejects(
        () => service.openAccountCodexSpace(parent.id, {
          country: 'IT',
          currency: 'EUR',
          credits: 16,
          card: { number: '4000000000000002', expiryMonth: 8, expiryYear: 2029, cvc: '456' }
        }),
        { status: 409, message: '该母号未关联 GPT Account Manager' }
      );
      assert.equal(accountManager.opened, undefined);
    });
  });

  it('controls only the selected parent workspace purchase operation', async () => {
    await withService(async (service, accountManager, _teamService, store) => {
      const parent = await store.add({
        managedAccountEmail: 'owner@example.com',
        accountId: 'personal-account',
        email: 'owner@example.com',
        accessToken: 'web-access-token'
      });
      accountManager.operations.push({
        id: 'codex-control-1',
        accountId: 'owner@example.com',
        type: 'open_codex_space',
        status: 'waiting_manual',
        phase: 'payment_waiting_manual',
        message: '等待人工',
        progress: 70,
        requestSummary: { requestTag: ACCOUNT_MANAGER_REQUEST_TAGS.parent },
        createdAt: 1,
        updatedAt: 1
      });

      const rotated = await service.rotateAccountOperationIp(parent.id, 'codex-control-1');
      assert.equal(rotated.phase, 'proxy_rotation_requested');
      const terminated = await service.terminateAccountOperation(parent.id, 'codex-control-1');

      assert.equal(terminated.status, 'interrupted');
      assert.deepEqual(accountManager.controls, [
        'rotate:codex-control-1',
        'terminate:codex-control-1'
      ]);
    });
  });
});
