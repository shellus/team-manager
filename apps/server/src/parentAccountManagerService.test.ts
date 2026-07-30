import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type {
  AccountManagerOperationView,
  AccountManagerProfileView,
  AccountView,
  OpenCodexSpaceRequest,
  OpenPro5xRequest,
  OpenTeamSubscriptionRequest,
  Pro5xPaymentStatisticsView,
  ResidentialProxyConfig,
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

function paymentStatisticsFixture(): Pro5xPaymentStatisticsView {
  return {
    totalAttempts: 2,
    decisionAttempts: 2,
    uniqueOperations: 1,
    succeeded: 1,
    paymentNotApproved: 1,
    cardDeclined: 0,
    technicalFailures: 0,
    interrupted: 0,
    waitingManual: 0,
    pending: 0,
    transitions: {
      payment_not_approved_to_succeeded: 1,
      payment_not_approved_to_payment_not_approved: 0,
      payment_not_approved_to_card_declined: 0,
      card_declined_to_succeeded: 0,
      card_declined_to_payment_not_approved: 0,
      card_declined_to_card_declined: 0
    },
    recentAttempts: [{
      id: 'attempt-2',
      operationId: 'operation-1',
      accountId: 'owner@example.com',
      cardLast4: '4242',
      cardFingerprintSuffix: 'fingerprint-1',
      number: 2,
      startedAt: 2_000,
      completedAt: 3_000,
      outcome: 'succeeded',
      decision: 'succeeded',
      proxyObservation: {
        sid: 'sid-2',
        ip: '203.0.113.2',
        country: 'SG',
        asn: 'AS18106',
        state: null,
        city: null,
        observedAt: 2_100
      },
      checkoutSessionId: 'cs_live_2',
      checkoutRecreated: true,
      intervalFromPreviousMs: 500,
      cardHardFailure: false
    }],
    updatedAt: 3_000
  };
}

class FakeAccountManager implements AccountManagerGateway {
  operations: AccountManagerOperationView[] = [];
  accounts = new Map<string, ManagedAccountSummary>();
  opened?: { accountId: string; input: OpenCodexSpaceRequest & { requestTag?: string } };
  openedTeam?: { accountId: string; input: OpenTeamSubscriptionRequest & { requestTag?: string } };
  openedPro5x?: { accountId: string; input: OpenPro5xRequest & { requestTag?: string } };
  providedCards: Array<{ operationId: string; input: OpenPro5xRequest }> = [];
  controls: string[] = [];
  syncCalls: string[] = [];
  listAccountsCalls = 0;
  accountCalls = 0;
  listAccountOperationsCalls = 0;
  profileControls: string[] = [];
  profiles = new Map<string, AccountManagerProfileView>();
  proxyConfigs = new Map<string, ResidentialProxyConfig>();

  async health() { return { status: 'ok', accountRegistrationConfigured: true }; }

  async pro5xPaymentStatistics(): Promise<Pro5xPaymentStatisticsView> {
    return paymentStatisticsFixture();
  }

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
      requestSummary: {
        requestTag: input.requestTag,
        clientReference: input.clientReference,
        country: input.country
      },
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

  async startAccountImport(input: {
    email: string;
    authMethod: 'email_otp' | 'password' | 'existing_session';
    password?: string;
    session?: AccountView['session'];
  }) {
    const operation: AccountManagerOperationView = {
      id: `import-${this.operations.length}`,
      type: 'import',
      status: 'queued',
      phase: 'profile_creating',
      progress: 0,
      requestSummary: { email: input.email, authMethod: input.authMethod },
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.operations.push(operation);
    return operation;
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

  async retryOperationCurrentStep(id: string) {
    const operation = await this.operation(id);
    this.controls.push(`retry:${id}`);
    operation.phase = 'pro5x_retry_requested';
    operation.message = '已请求重试当前步骤';
    return operation;
  }

  async operationProxyConfig(id: string) {
    await this.operation(id);
    return this.proxyConfigs.get(id) ?? {
      sid: 'initial-sid', country: 'US', asn: null, state: null, city: null
    };
  }

  async configureOperationProxy(id: string, input: ResidentialProxyConfig) {
    await this.operation(id);
    this.proxyConfigs.set(id, input);
    return input;
  }

  async terminateOperation(id: string) {
    const operation = await this.operation(id);
    this.controls.push(`terminate:${id}`);
    operation.status = 'interrupted';
    operation.phase = operation.type === 'register' ? 'registration_cancelled' : 'operation_terminated';
    operation.errorCode = operation.type === 'register'
      ? 'registration_cancelled_by_user'
      : 'operation_terminated_by_user';
    operation.errorMessage = operation.type === 'register' ? '注册任务已取消' : '任务已由用户终止';
    return operation;
  }

  async provideOperationPaymentCard(id: string, input: OpenPro5xRequest) {
    const operation = await this.operation(id);
    this.providedCards.push({ operationId: id, input });
    operation.phase = 'pro5x_payment_card_received';
    operation.message = '已收到信用卡';
    operation.progress = 61;
    operation.requestSummary = {
      ...operation.requestSummary,
      cardLast4: input.card.number.slice(-4)
    };
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

  async syncAccount(accountId: string) {
    this.syncCalls.push(accountId);
    return this.account(accountId);
  }

  async accountProfile(accountId: string): Promise<AccountManagerProfileView> {
    return this.profiles.get(accountId) ?? { accountId, status: 'stopped', updatedAt: 1 };
  }

  async listAccountProfiles(): Promise<Record<string, AccountManagerProfileView>> {
    const accountIds = new Set([...this.accounts.keys(), ...this.profiles.keys()]);
    return Object.fromEntries(
      [...accountIds].map((accountId) => [accountId, this.profiles.get(accountId) ?? {
        accountId,
        status: 'stopped' as const,
        updatedAt: 1
      }])
    );
  }

  async startAccountProfile(accountId: string): Promise<AccountManagerProfileView> {
    this.profileControls.push(`start:${accountId}`);
    const profile = {
      accountId, status: 'running' as const, profileId: 'runtime-profile', updatedAt: 2
    };
    this.profiles.set(accountId, profile);
    return profile;
  }

  async stopAccountProfile(accountId: string): Promise<AccountManagerProfileView> {
    this.profileControls.push(`stop:${accountId}`);
    const profile = { accountId, status: 'stopped' as const, updatedAt: 3 };
    this.profiles.set(accountId, profile);
    return profile;
  }

  async accountProxyConfig(accountId: string) {
    return this.proxyConfigs.get(accountId) ?? {
      sid: 'initial-sid', country: 'US', asn: null, state: null, city: null
    };
  }

  async configureAccountProxy(accountId: string, input: ResidentialProxyConfig) {
    this.proxyConfigs.set(accountId, input);
    return input;
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

  async openPro5x(accountId: string, input: OpenPro5xRequest & { requestTag?: string }) {
    this.openedPro5x = { accountId, input };
    const operation: AccountManagerOperationView = {
      id: `pro5x-${this.operations.length}`,
      accountId,
      type: 'open_pro_5x',
      status: 'queued',
      phase: 'pro5x_queued',
      progress: 0,
      requestSummary: { requestTag: input.requestTag, cardLast4: input.card.number.slice(-4) },
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

  completeImport(email: string) {
    const operation = this.operations.find((item) => item.type === 'import')!;
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
  constructor(private readonly store: AccountStore) {}
  saved: Array<{
    kind: 'identity' | 'workspace';
    email: string;
    preferredAccountId?: string;
    groupName?: string;
  }> = [];
  teamSubscriptionIds = new Set<string>();
  refreshCalls: string[] = [];
  refreshResult?: AccountView;
  sessionUpdates: Array<{ id: string; session: unknown }> = [];

  hasTeamSubscription(id: string): boolean {
    return this.teamSubscriptionIds.has(id);
  }

  async refreshAccount(id: string): Promise<AccountView> {
    this.refreshCalls.push(id);
    if (!this.refreshResult) throw new Error('refresh result missing');
    return this.refreshResult;
  }

  async updateLocalProfile(id: string, input: { session?: any }): Promise<AccountView> {
    if (input.session) {
      this.sessionUpdates.push({ id, session: input.session });
      await this.store.update(id, {
        accessToken: input.session.accessToken,
        sessionToken: input.session.sessionToken
      });
    }
    return this.getAccountDetail(id);
  }

  async getAccountDetail(id: string): Promise<AccountView> {
    const account = this.store.get(id);
    if (!account) throw new Error('account missing');
    return {
      id: account.id,
      managedAccountEmail: account.managedAccountEmail,
      remark: account.remark,
      groupName: account.groupName || '默认分组',
      limitType: account.limitType || 'unknown',
      accountId: account.accountId,
      email: account.email,
      planType: account.planType,
      status: account.status || 'unknown',
      hasTeamSubscription: account.hasTeamSubscription === true || account.planType === 'team',
      canManageWorkspace: account.planType !== 'free'
    };
  }

  async saveManagedParentIdentityFromSessionInput(email: string, _raw: unknown, groupName?: string): Promise<AccountView> {
    this.saved.push({ kind: 'identity', email, groupName });
    return {
      id: 'parent-personal',
      managedAccountEmail: email,
      groupName: groupName || '默认分组',
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
  const teamService = new FakeTeamService(store);
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
  it('proxies Pro 5x payment statistics from Account Manager', async () => {
    await withService(async (service) => {
      const statistics = await service.pro5xPaymentStatistics();
      assert.equal(statistics.totalAttempts, 2);
      assert.equal(statistics.transitions.payment_not_approved_to_succeeded, 1);
      assert.equal(statistics.recentAttempts[0]?.proxyObservation?.ip, '203.0.113.2');
    });
  });

  it('writes a refreshed GAM Web Session back while a Pro 5x operation is active', async () => {
    await withService(async (service, accountManager, teamService, store) => {
      const parent = await store.add({
        managedAccountEmail: 'owner@example.com',
        accountId: 'personal-account',
        email: 'owner@example.com',
        accessToken: 'stale-access-token',
        sessionToken: 'stale-session-token',
        planType: 'free'
      });
      accountManager.accounts.set('owner@example.com', {
        id: 'owner@example.com',
        email: 'owner@example.com',
        hasCodexSpace: false,
        hasTeamSubscription: false,
        hasPro5x: false,
        workspaces: []
      });
      accountManager.operations.push({
        id: 'pro5x-active',
        accountId: 'owner@example.com',
        type: 'open_pro_5x',
        status: 'waiting_manual',
        phase: 'pro5x_login_session_refreshed',
        progress: 34,
        requestSummary: { requestTag: ACCOUNT_MANAGER_REQUEST_TAGS.parent },
        createdAt: 1,
        updatedAt: 2
      });

      await service.accountStatus(parent.id);

      assert.equal(store.get(parent.id)?.accessToken, 'web-access-token');
      assert.equal(store.get(parent.id)?.sessionToken, 'session-token');
      assert.equal(teamService.sessionUpdates.length, 1);
    });
  });

  it('starts an email-OTP GAM import for an existing unmanaged parent', async () => {
    await withService(async (service, accountManager, _teamService, store) => {
      const parent = await store.add({
        accountId: 'team-workspace',
        email: 'Owner@Example.com',
        accessToken: 'web-access-token',
        planType: 'team'
      });

      const status = await service.startAccountManagement(parent.id);

      assert.equal(status.managed, false);
      assert.equal(status.enrollmentOperation?.type, 'import');
      assert.equal(status.enrollmentOperation?.requestSummary?.email, 'owner@example.com');
      assert.equal(status.enrollmentOperation?.requestSummary?.authMethod, 'email_otp');
      assert.equal(store.get(parent.id)?.managedAccountEmail, undefined);
      assert.equal(accountManager.operations.filter((operation) => operation.type === 'import').length, 1);
    });
  });

  it('prefers the existing Team Manager session when it can bootstrap GAM identity', async () => {
    await withService(async (service, _accountManager, _teamService, store) => {
      const parent = await store.add({
        accountId: 'team-workspace',
        email: 'Owner@Example.com',
        accessToken: 'web-access-token',
        sessionToken: 'session-token',
        planType: 'team'
      });

      const status = await service.startAccountManagement(parent.id);

      assert.equal(status.enrollmentOperation?.requestSummary?.authMethod, 'existing_session');
      assert.equal(status.enrollmentOperation?.requestSummary?.email, 'owner@example.com');
      assert.equal(status.enrollmentOperation?.requestSummary?.session, undefined);
    });
  });

  it('removes all terminal import history before retrying the same parent', async () => {
    await withService(async (service, accountManager, _teamService, store) => {
      const parent = await store.add({
        accountId: 'team-workspace',
        email: 'owner@example.com',
        accessToken: 'web-access-token',
        planType: 'team'
      });
      await service.startAccountManagement(parent.id);
      accountManager.operations[0]!.status = 'failed';
      accountManager.operations.push({
        id: 'older-import',
        type: 'import',
        status: 'interrupted',
        phase: 'operation_interrupted',
        progress: 100,
        requestSummary: { email: 'owner@example.com', authMethod: 'email_otp' },
        createdAt: 0,
        updatedAt: 0
      });

      await service.startAccountManagement(parent.id);

      assert.equal(accountManager.operations.length, 1);
      assert.equal(accountManager.operations[0]?.status, 'queued');
    });
  });

  it('links the original parent after its GAM import succeeds without replacing local workspace data', async () => {
    await withService(async (service, accountManager, _teamService, store) => {
      const parent = await store.add({
        accountId: 'team-workspace',
        email: 'Owner@Example.com',
        accessToken: 'existing-workspace-token',
        planType: 'team',
        remark: '客户备注'
      });
      await service.startAccountManagement(parent.id);
      accountManager.completeImport('owner@example.com');

      const statuses = await service.accountStatuses();

      assert.equal(statuses[parent.id]?.managed, true);
      assert.equal(statuses[parent.id]?.importedAccounts?.[0]?.id, parent.id);
      assert.equal(store.get(parent.id)?.managedAccountEmail, 'owner@example.com');
      assert.equal(store.get(parent.id)?.accountId, 'team-workspace');
      assert.equal(store.get(parent.id)?.accessToken, 'existing-workspace-token');
      assert.equal(store.get(parent.id)?.remark, '客户备注');
      assert.equal(accountManager.operations.filter((operation) => operation.type === 'import').length, 0);
    });
  });

  it('links an account already present in GAM without starting a duplicate import', async () => {
    await withService(async (service, accountManager, _teamService, store) => {
      const parent = await store.add({
        accountId: 'team-workspace',
        email: 'owner@example.com',
        accessToken: 'web-access-token',
        planType: 'team'
      });
      accountManager.accounts.set('owner@example.com', {
        id: 'owner@example.com',
        email: 'owner@example.com',
        hasCodexSpace: false,
        hasTeamSubscription: false,
        workspaces: []
      });

      const status = await service.startAccountManagement(parent.id);

      assert.equal(status.managed, true);
      assert.equal(status.importedAccounts?.[0]?.id, parent.id);
      assert.equal(store.get(parent.id)?.managedAccountEmail, 'owner@example.com');
      assert.equal(accountManager.operations.filter((operation) => operation.type === 'import').length, 0);
    });
  });

  it('proxies managed parent Profile lifecycle without calling CloakBrowser directly', async () => {
    await withService(async (service, accountManager, _teamService, store) => {
      const parent = await store.add({
        managedAccountEmail: 'owner@example.com',
        accountId: 'personal-account',
        email: 'owner@example.com',
        accessToken: 'web-access-token'
      });

      assert.equal((await service.accountProfile(parent.id)).status, 'stopped');
      assert.equal((await service.startAccountProfile(parent.id)).profileId, 'runtime-profile');
      assert.equal((await service.accountProfiles())[parent.id]?.status, 'running');
      assert.equal((await service.stopAccountProfile(parent.id)).status, 'stopped');
      assert.deepEqual(await service.accountProxyConfig(parent.id), {
        sid: 'initial-sid', country: 'US', asn: null, state: null, city: null
      });
      assert.deepEqual(await service.configureAccountProxy(parent.id, {
        sid: 'custom-sid', country: 'SG', asn: 'AS64512', state: null, city: null
      }), {
        sid: 'custom-sid', country: 'SG', asn: 'AS64512', state: null, city: null
      });
      assert.deepEqual(accountManager.profileControls, [
        'start:owner@example.com',
        'stop:owner@example.com'
      ]);
    });
  });

  it('finishes parent registration immediately without requiring 0.52', async () => {
    await withService(async (service, accountManager, teamService) => {
      const started = await service.startRegistration({
        groupName: ' 客户 A ',
        country: 'sg'
      });
      assert.equal(started.requestSummary?.requestTag, ACCOUNT_MANAGER_REQUEST_TAGS.parent);
      assert.equal(started.requestSummary?.clientReference, '客户 A');
      assert.equal(started.requestSummary?.country, 'SG');

      accountManager.completeRegistration('parent@example.com');
      const completed = await service.listRegistrationTasks();
      assert.equal(completed[0]!.stage, 'completed');
      assert.equal(completed[0]!.parent?.accountId, 'personal-account');
      assert.deepEqual(teamService.saved, [{
        kind: 'identity',
        email: 'parent@example.com',
        groupName: '客户 A'
      }]);
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

  it('reflects a successful 0.52 operation before the batched account summary catches up', async () => {
    await withService(async (service, accountManager, _teamService, store) => {
      const parent = await store.add({
        managedAccountEmail: 'owner@example.com',
        accountId: 'personal-account',
        email: 'owner@example.com',
        accessToken: 'web-access-token',
        planType: 'free'
      });
      accountManager.accounts.set('owner@example.com', {
        id: 'owner@example.com',
        email: 'owner@example.com',
        hasCodexSpace: false,
        hasTeamSubscription: false,
        workspaces: []
      });
      accountManager.operations.push({
        id: 'codex-succeeded',
        accountId: 'owner@example.com',
        type: 'open_codex_space',
        status: 'succeeded',
        phase: 'complete',
        progress: 100,
        requestSummary: { requestTag: ACCOUNT_MANAGER_REQUEST_TAGS.parent },
        result: { workspaces: [{ id: 'codex-workspace' }] },
        createdAt: 1,
        updatedAt: 2,
        completedAt: 2
      });

      const pendingReconciliation = await service.accountStatuses();

      assert.equal(pendingReconciliation[parent.id]!.hasCodexSpace, true);
      assert.equal(pendingReconciliation[parent.id]!.codexOperation?.id, 'codex-succeeded');

      accountManager.accounts.set('owner@example.com', {
        id: 'owner@example.com',
        email: 'owner@example.com',
        hasCodexSpace: true,
        hasTeamSubscription: false,
        workspaces: [{
          id: 'codex-workspace',
          structure: 'workspace',
          planType: 'self_serve_business_usage_based',
          visible: true
        }]
      });

      const reconciled = await service.accountStatuses();

      assert.equal(reconciled[parent.id]!.hasCodexSpace, true);
      assert.equal(reconciled[parent.id]!.codexOperation, undefined);
      assert.equal(accountManager.operations.length, 0);
    });
  });

  it('recognizes a locally synchronized 0.52 Workspace after the payment task was terminated', async () => {
    await withService(async (service, accountManager, _teamService, store) => {
      const parent = await store.add({
        managedAccountEmail: 'owner@example.com',
        accountId: 'codex-workspace',
        email: 'owner@example.com',
        accessToken: 'web-access-token',
        planType: 'self_serve_business_usage_based'
      });
      accountManager.accounts.set('owner@example.com', {
        id: 'owner@example.com',
        email: 'owner@example.com',
        hasCodexSpace: false,
        hasTeamSubscription: false,
        workspaces: [{
          id: 'personal-account',
          structure: 'personal',
          planType: 'free',
          visible: true
        }]
      });

      assert.equal((await service.accountStatus(parent.id)).hasCodexSpace, true);
      assert.equal((await service.accountStatuses())[parent.id]!.hasCodexSpace, true);
      await assert.rejects(
        () => service.openAccountCodexSpace(parent.id, {
          country: 'IT',
          currency: 'EUR',
          credits: 16,
          card: { number: '4000000000000002', expiryMonth: 8, expiryYear: 2029, cvc: '456' }
        }),
        { status: 409, message: '该账号已开通 0.52 Codex 空间' }
      );
    });
  });

  it('syncs the linked Account Manager account during one Workspace refresh action', async () => {
    await withService(async (service, accountManager, teamService, store) => {
      const parent = await store.add({
        managedAccountEmail: 'owner@example.com',
        accountId: 'personal-account',
        email: 'owner@example.com',
        accessToken: 'web-access-token',
        planType: 'free'
      });
      accountManager.accounts.set('owner@example.com', {
        id: 'owner@example.com',
        email: 'owner@example.com',
        hasCodexSpace: false,
        hasTeamSubscription: false,
        hasPro5x: true,
        workspaces: []
      });
      teamService.refreshResult = {
        id: parent.id,
        managedAccountEmail: 'owner@example.com',
        groupName: '默认分组',
        limitType: 'unknown',
        accountId: 'codex-workspace',
        email: 'owner@example.com',
        planType: 'self_serve_business_usage_based',
        status: 'active',
        hasTeamSubscription: false,
        canManageWorkspace: true
      };

      const refreshed = await service.refreshAccount(parent.id);

      assert.equal(refreshed.planType, 'self_serve_business_usage_based');
      assert.equal(refreshed.accountManagerHasPro5x, true);
      assert.equal(refreshed.accountManagerPro5xCardLast4, '4242');
      assert.equal(store.get(parent.id)?.accountManagerPro5xCardLast4, '4242');
      assert.deepEqual(teamService.refreshCalls, [parent.id]);
      assert.deepEqual(accountManager.syncCalls, ['owner@example.com']);
    });
  });

  it('does not launch Account Manager sync while a Workspace purchase still owns the profile', async () => {
    await withService(async (service, accountManager, teamService, store) => {
      const parent = await store.add({
        managedAccountEmail: 'owner@example.com',
        accountId: 'personal-account',
        email: 'owner@example.com',
        accessToken: 'web-access-token',
        planType: 'free'
      });
      accountManager.operations.push({
        id: 'codex-active',
        accountId: 'owner@example.com',
        type: 'open_codex_space',
        status: 'waiting_manual',
        phase: 'payment_waiting_manual',
        progress: 70,
        requestSummary: { requestTag: ACCOUNT_MANAGER_REQUEST_TAGS.parent },
        createdAt: 1,
        updatedAt: 1
      });
      teamService.refreshResult = {
        id: parent.id,
        managedAccountEmail: 'owner@example.com',
        groupName: '默认分组',
        limitType: 'unknown',
        accountId: 'personal-account',
        email: 'owner@example.com',
        planType: 'free',
        status: 'active',
        hasTeamSubscription: false,
        canManageWorkspace: false
      };

      await service.refreshAccount(parent.id);

      assert.deepEqual(teamService.refreshCalls, [parent.id]);
      assert.deepEqual(accountManager.syncCalls, []);
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

  it('rejects a duplicate Team order when local billing already recognized the subscription', async () => {
    await withService(async (service, accountManager, teamService, store) => {
      const parent = await store.add({
        managedAccountEmail: 'owner@example.com',
        accountId: 'upgraded-workspace',
        email: 'owner@example.com',
        accessToken: 'web-access-token',
        planType: 'self_serve_business_usage_based',
        hasTeamSubscription: true
      });
      teamService.teamSubscriptionIds.add(parent.id);
      accountManager.accounts.set('owner@example.com', {
        id: 'owner@example.com',
        email: 'owner@example.com',
        hasCodexSpace: true,
        hasTeamSubscription: false,
        workspaces: [{
          id: 'upgraded-workspace',
          structure: 'workspace',
          planType: 'self_serve_business_usage_based',
          visible: true
        }]
      });

      await assert.rejects(
        () => service.openAccountTeamSubscription(parent.id, {
          workspaceId: 'upgraded-workspace',
          country: 'GB',
          currency: 'GBP',
          autoPay: false
        }),
        { status: 409, message: '该账号已开通双席位 Team' }
      );
      assert.equal(accountManager.openedTeam, undefined);
    });
  });

  it('opens Pro 5x with a required card and reflects the personal plan after GAM sync', async () => {
    await withService(async (service, accountManager, _teamService, store) => {
      const parent = await store.add({
        managedAccountEmail: 'owner@example.com',
        accountId: 'personal-account',
        email: 'owner@example.com',
        accessToken: 'web-access-token',
        planType: 'free'
      });
      accountManager.accounts.set('owner@example.com', {
        id: 'owner@example.com',
        email: 'owner@example.com',
        hasCodexSpace: false,
        hasTeamSubscription: false,
        hasPro5x: false,
        workspaces: []
      });

      const operation = await service.openAccountPro5x(parent.id, {
        autoPay: false,
        usePromoCode: true,
        promoCode: 'current-promo',
        card: { number: '4242424242424242', expiryMonth: 7, expiryYear: 2028, cvc: '123' }
      });
      assert.equal(operation.type, 'open_pro_5x');
      assert.equal(accountManager.openedPro5x?.accountId, 'owner@example.com');
      assert.equal(accountManager.openedPro5x?.input.requestTag, ACCOUNT_MANAGER_REQUEST_TAGS.parent);
      assert.equal(accountManager.openedPro5x?.input.autoPay, true);
      assert.equal(accountManager.openedPro5x?.input.usePromoCode, true);
      assert.equal(accountManager.openedPro5x?.input.promoCode, 'current-promo');

      const storedOperation = accountManager.operations.find((item) => item.id === operation.id)!;
      storedOperation.status = 'waiting_manual';
      storedOperation.phase = 'pro5x_payment_card_required';
      await service.provideAccountPro5xPaymentCard(parent.id, operation.id, {
        card: { number: '5555555555554444', expiryMonth: 8, expiryYear: 2029, cvc: '456' }
      });
      assert.equal(accountManager.providedCards[0]?.operationId, operation.id);
      assert.equal(accountManager.providedCards[0]?.input.autoPay, true);
      assert.equal(accountManager.providedCards[0]?.input.card.number, '5555555555554444');

      storedOperation.phase = 'payment_processing_manual';
      const retried = await service.retryAccountOperationCurrentStep(parent.id, operation.id);
      assert.equal(retried.phase, 'pro5x_retry_requested');
      assert.deepEqual(accountManager.controls, [`retry:${operation.id}`]);

      accountManager.accounts.set('owner@example.com', {
        ...accountManager.accounts.get('owner@example.com')!,
        hasPro5x: true
      });
      storedOperation.status = 'succeeded';
      storedOperation.phase = 'complete';
      storedOperation.progress = 100;

      const status = await service.accountStatus(parent.id);
      assert.equal(status.hasPro5x, true);
      assert.equal(status.pro5xOperation, undefined);
      assert.equal(store.get(parent.id)?.accountManagerHasPro5x, true);
      assert.equal(store.get(parent.id)?.accountManagerPro5xCardLast4, '4444');
      assert.equal(typeof store.get(parent.id)?.accountManagerSyncedAt, 'number');
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
      assert.equal(await service.dismissAccountOperation(parent.id, 'codex-control-1'), true);
      assert.equal(accountManager.operations.some((operation) => operation.id === 'codex-control-1'), false);
      assert.deepEqual(accountManager.controls, [
        'rotate:codex-control-1',
        'terminate:codex-control-1'
      ]);
    });
  });

  it('rotates IP for a parent registration in any manual stage', async () => {
    await withService(async (service, accountManager) => {
      accountManager.operations.push({
        id: 'parent-registration-control',
        type: 'register',
        status: 'waiting_manual',
        phase: 'registration_stage_waiting_manual',
        message: '页面提交后暂未推进',
        progress: 95,
        requestSummary: { requestTag: ACCOUNT_MANAGER_REQUEST_TAGS.parent },
        createdAt: 1,
        updatedAt: 1
      });

      const rotated = await service.rotateRegistrationIp('parent-registration-control');

      assert.equal(rotated.registration.phase, 'proxy_rotation_requested');
      assert.equal(rotated.stage, 'waiting_manual');
      assert.deepEqual(accountManager.controls, ['rotate:parent-registration-control']);
    });
  });

  it('cancels an active parent registration through Account Manager', async () => {
    await withService(async (service, accountManager) => {
      accountManager.operations.push({
        id: 'parent-registration-cancel',
        type: 'register',
        status: 'running',
        phase: 'email_otp_send',
        message: '正在等待邮箱验证码',
        progress: 56,
        requestSummary: { requestTag: ACCOUNT_MANAGER_REQUEST_TAGS.parent },
        createdAt: 1,
        updatedAt: 1
      });

      const cancelled = await service.cancelRegistration('parent-registration-cancel');

      assert.equal(cancelled.registration.status, 'interrupted');
      assert.equal(cancelled.registration.phase, 'registration_cancelled');
      assert.equal(cancelled.stage, 'registration_failed');
      assert.deepEqual(accountManager.controls, ['terminate:parent-registration-cancel']);
    });
  });

  it('configures a parent registration proxy without restricting its phase', async () => {
    await withService(async (service, accountManager) => {
      accountManager.operations.push({
        id: 'parent-registration-running',
        type: 'register',
        status: 'running',
        phase: 'create_account',
        progress: 82,
        requestSummary: { requestTag: ACCOUNT_MANAGER_REQUEST_TAGS.parent },
        createdAt: 1,
        updatedAt: 1
      });

      const configured = await service.configureRegistrationProxy('parent-registration-running', {
        sid: 'running-sid', country: 'CA', asn: null, state: 'Ontario', city: 'Toronto'
      });

      assert.deepEqual(configured, {
        sid: 'running-sid', country: 'CA', asn: null, state: 'Ontario', city: 'Toronto'
      });
      assert.deepEqual(await service.registrationProxyConfig('parent-registration-running'), configured);
    });
  });
});
