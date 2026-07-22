import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type {
  ApiResult,
  AccountManagerOperationView,
  CodexCredentialJson,
  OpenCodexSpaceRequest,
  SubaccountLocalProfileView,
  SubaccountRegistrationJobView,
  SubaccountSummaryView,
  SubaccountView
} from '@team-manager/shared';
import { AccountStore } from './accountStore.js';
import { buildApp } from './app.js';
import {
  ACCOUNT_MANAGER_REQUEST_TAGS,
  type AccountManagerGateway,
  type AccountRegistrationRequest
} from './accountManagerClient.js';
import type { AppConfig } from './config.js';
import { SubaccountStore } from './subaccountStore.js';
import type { Transport } from './transport.js';

function hasOwn(value: object | undefined, key: string): boolean {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function unsignedJwt(payload: Record<string, unknown>): string {
  return `${base64UrlJson({ alg: 'none', typ: 'JWT' })}.${base64UrlJson(payload)}.signature`;
}

function chatGptWebAccessToken(accountId: string, planType = 'team'): string {
  return unsignedJwt({
    'https://api.openai.com/auth': {
      chatgpt_account_id: accountId,
      chatgpt_plan_type: planType,
      chatgpt_user_id: 'user-child'
    },
    exp: 1783387600
  });
}

function patCredential(accountId: string, token = `at-${accountId}`): CodexCredentialJson {
  return {
    access_token: token,
    personal_access_token: token,
    account_id: accountId,
    email: 'child@example.com',
    type: 'codex',
    last_refresh: '2026-06-18T00:00:00.000Z',
    expired: '2026-07-18T00:00:00.000Z',
    plan_type: 'team',
    auth_mode: 'personalAccessToken',
    credential_source: 'personal_access_token'
  };
}

class RecordingQuotaTransport implements Transport {
  requests: Array<{ method: string; path: string; headers: Record<string, string>; body?: string }> = [];

  async fetch(req: { method: string; path: string; headers: Record<string, string>; body?: string }) {
    this.requests.push(req);
    return {
      status: 200,
      body: JSON.stringify({
        plan_type: 'team',
        rate_limit: {
          primary_window: {
            used_percent: 28,
            limit_window_seconds: 18000
          }
        }
      })
    };
  }
}

type RawTeamMember = {
  id: string;
  email: string;
  name?: string;
  role: string;
  seat_type?: string;
  status?: string;
};

type RawTeamInvite = {
  id: string;
  email_address: string;
  role: string;
  status: number;
  seat_type: string;
  created_time: string;
  is_scim_managed: boolean;
};

class RecordingTeamTransport implements Transport {
  requests: Array<{ method: string; path: string; headers: Record<string, string>; body?: string }> = [];
  membersByWorkspaceId = new Map<string, RawTeamMember[]>();
  invitesByWorkspaceId = new Map<string, RawTeamInvite[]>();
  accountsCheckByAccessToken = new Map<string, Record<string, unknown>>();
  settingsByWorkspaceId = new Map<string, Record<string, unknown>>();
  sessionAccessTokensByWorkspaceId = new Map<string, string>();
  invalidatedAccessTokens = new Set<string>();
  revokedAccessTokens = new Set<string>();
  currentSessionAccountId = 'browser-current-workspace-id';
  personalAccessTokenWorkspaceId = 'workspace-account-id';
  personalProfile = {
    user_id: 'user-child',
    username: 'child-user',
    display_name: 'Child User',
    profile_picture_url: 'https://example.invalid/child.png'
  };
  personalProfileUnavailable = false;
  marketingPushEnabled = true;
  marketingEmailEnabled = false;
  memoryEnabled = true;

  private authFailure(req: { headers: Record<string, string> }) {
    const token = req.headers.Authorization?.replace(/^Bearer\s+/i, '') ?? '';
    if (this.invalidatedAccessTokens.has(token)) return tokenInvalidatedResponse();
    if (this.revokedAccessTokens.has(token)) return tokenRevokedResponse();
    return undefined;
  }

  private notificationSettings() {
    return {
      settings: [
        {
          category: 'marketing',
          options: [
            { channel: 'push', enabled: this.marketingPushEnabled },
            { channel: 'email', enabled: this.marketingEmailEnabled }
          ]
        }
      ]
    };
  }

  async fetch(req: { method: string; path: string; headers: Record<string, string>; body?: string }) {
    this.requests.push(req);
    if (req.method === 'GET' && req.path.startsWith('/api/auth/session')) {
      const cookie = req.headers.cookie ?? req.headers.Cookie ?? '';
      const requestedUrl = new URL(`https://chatgpt.com${req.path}`);
      const requestedWorkspaceId =
        requestedUrl.searchParams.get('workspace_id') ?? requestedUrl.searchParams.get('team_manager_workspace');
      const accountId = requestedWorkspaceId ?? cookie.match(/(?:^|;\s*)_account=([^;]+)/)?.[1] ?? this.currentSessionAccountId;
      return {
        status: 200,
        body: JSON.stringify({
          user: { email: 'child@example.com' },
          account: { id: accountId },
          accessToken:
            this.sessionAccessTokensByWorkspaceId.get(accountId) ??
            chatGptWebAccessToken(accountId, accountId.startsWith('personal') ? 'free' : 'team')
        })
      };
    }
    if (req.method === 'GET' && req.path === '/backend-api/me') {
      const failed = this.authFailure(req);
      if (failed) return failed;
      return {
        status: 200,
        body: JSON.stringify({
          object: 'user',
          id: this.personalProfile.user_id,
          email: 'child@example.com',
          name: this.personalProfile.display_name,
          picture: this.personalProfile.profile_picture_url
        })
      };
    }
    if (req.method === 'GET' && /^\/backend-api\/calpico\/chatgpt\/profile\/[^/]+$/.test(req.path)) {
      const failed = this.authFailure(req);
      if (failed) return failed;
      if (this.personalProfileUnavailable) {
        return {
          status: 401,
          body: JSON.stringify({
            error: {
              message: 'You must be a member of an organization to use the API.',
              type: 'invalid_request_error',
              code: 'no_organization',
              param: null
            },
            status: 401
          })
        };
      }
      return { status: 200, body: JSON.stringify(this.personalProfile) };
    }
    if (req.method === 'POST' && /\/backend-api\/calpico\/chatgpt\/profile\/[^/]+\/username$/.test(req.path)) {
      const failed = this.authFailure(req);
      if (failed) return failed;
      const body = JSON.parse(req.body ?? '{}') as { username?: string };
      this.personalProfile = { ...this.personalProfile, username: body.username ?? this.personalProfile.username };
      return { status: 200, body: JSON.stringify(this.personalProfile) };
    }
    if (req.method === 'POST' && /^\/backend-api\/calpico\/chatgpt\/profile\/[^/]+$/.test(req.path)) {
      const failed = this.authFailure(req);
      if (failed) return failed;
      const body = JSON.parse(req.body ?? '{}') as { display_name?: string };
      this.personalProfile = {
        ...this.personalProfile,
        display_name: body.display_name ?? this.personalProfile.display_name
      };
      return { status: 200, body: JSON.stringify(this.personalProfile) };
    }
    if (req.path === '/backend-api/notifications/settings') {
      const failed = this.authFailure(req);
      if (failed) return failed;
      if (req.method === 'PATCH') {
        const body = JSON.parse(req.body ?? '{}') as {
          updates?: { marketing?: { push?: boolean; email?: boolean } };
        };
        const marketing = body.updates?.marketing;
        if (typeof marketing?.push === 'boolean') this.marketingPushEnabled = marketing.push;
        if (typeof marketing?.email === 'boolean') this.marketingEmailEnabled = marketing.email;
      }
      return { status: 200, body: JSON.stringify(this.notificationSettings()) };
    }
    if (req.method === 'PATCH' && req.path.startsWith('/backend-api/settings/account_user_setting?')) {
      const failed = this.authFailure(req);
      if (failed) return failed;
      this.memoryEnabled = new URL(`https://chatgpt.com${req.path}`).searchParams.get('value') === 'true';
      return { status: 200, body: JSON.stringify({ m3m: this.memoryEnabled }) };
    }
    if (req.method === 'GET' && req.path === '/backend-api/wham/rate-limit-reset-credits') {
      const failed = this.authFailure(req);
      if (failed) return failed;
      return {
        status: 200,
        body: JSON.stringify({ credits: [{ source: 'promotion', count: 2 }], available_count: 2, total_earned_count: 3 })
      };
    }
    if (req.method === 'GET' && req.path.startsWith('/backend-api/accounts/check/')) {
      const token = req.headers.Authorization?.replace(/^Bearer\s+/i, '') ?? '';
      if (this.invalidatedAccessTokens.has(token)) return tokenInvalidatedResponse();
      if (this.revokedAccessTokens.has(token)) return tokenRevokedResponse();
      return {
        status: 200,
        body: JSON.stringify({
          accounts: this.accountsCheckByAccessToken.get(token) ?? {},
          account_ordering: Object.keys(this.accountsCheckByAccessToken.get(token) ?? {})
        })
      };
    }
    if (req.method === 'GET' && req.path.includes('/users?')) {
      const token = req.headers.Authorization?.replace(/^Bearer\s+/i, '') ?? '';
      if (this.invalidatedAccessTokens.has(token)) return tokenInvalidatedResponse();
      if (this.revokedAccessTokens.has(token)) return tokenRevokedResponse();
      const workspaceId = req.path.match(/\/backend-api\/accounts\/([^/]+)\/users/)?.[1] ?? '';
      const items = this.membersByWorkspaceId.get(workspaceId) ?? [];
      return { status: 200, body: JSON.stringify({ items, total: items.length }) };
    }
    if (req.method === 'GET' && /\/backend-api\/accounts\/[^/]+\/settings$/.test(req.path)) {
      const token = req.headers.Authorization?.replace(/^Bearer\s+/i, '') ?? '';
      if (this.invalidatedAccessTokens.has(token)) return tokenInvalidatedResponse();
      if (this.revokedAccessTokens.has(token)) return tokenRevokedResponse();
      const workspaceId = req.path.match(/\/backend-api\/accounts\/([^/]+)\/settings$/)?.[1] ?? '';
      return { status: 200, body: JSON.stringify(this.settingsByWorkspaceId.get(workspaceId) ?? {}) };
    }
    if (req.method === 'POST' && req.path.includes('/settings/')) {
      const token = req.headers.Authorization?.replace(/^Bearer\s+/i, '') ?? '';
      if (this.invalidatedAccessTokens.has(token)) return tokenInvalidatedResponse();
      if (this.revokedAccessTokens.has(token)) return tokenRevokedResponse();
      const workspaceId = req.path.match(/\/backend-api\/accounts\/([^/]+)\/settings\//)?.[1] ?? '';
      const setting = req.path.split('/').at(-1) ?? '';
      const value = JSON.parse(req.body ?? '{}') as { value?: unknown };
      const current = this.settingsByWorkspaceId.get(workspaceId) ?? {};
      const key = setting === 'default_seat_type' ? 'default_seat_type' : setting;
      const next = { ...current, [key]: value.value };
      this.settingsByWorkspaceId.set(workspaceId, next);
      return { status: 200, body: JSON.stringify(next) };
    }
    if (req.method === 'GET' && req.path.includes('/invites?')) {
      const workspaceId = req.path.match(/\/backend-api\/accounts\/([^/]+)\/invites/)?.[1] ?? '';
      const items = this.invitesByWorkspaceId.get(workspaceId) ?? [];
      return { status: 200, body: JSON.stringify({ items, total: items.length }) };
    }
    if (req.method === 'POST' && req.path.includes('/invites')) {
      return { status: 200, body: JSON.stringify({ success: true }) };
    }
    if (req.method === 'DELETE' && req.path.includes('/users/')) {
      return { status: 200, body: JSON.stringify({ success: true }) };
    }
    if (req.method === 'POST' && req.path === '/backend-api/wham/auth-credentials') {
      return {
        status: 200,
        body: JSON.stringify({
          credential_id: 'token_generated',
          created_at: 1782350457,
          owner_user_id: 'user-child',
          creator_user_email: 'child@example.com',
          name: 'team-manager',
          workspace_id: this.personalAccessTokenWorkspaceId,
          scopes: ['chatgpt.workspace.feature.allow-codex-local-access.access'],
          expires_at: 1784942457,
          revoked: false,
          expired: false,
          access_token: 'at-generated-codex-token'
        })
      };
    }
    return { status: 404, body: JSON.stringify({ error: 'not found' }) };
  }
}

function tokenInvalidatedResponse() {
  return {
    status: 401,
    body: JSON.stringify({
      error: {
        message: 'Your authentication token has been invalidated. Please try signing in again.',
        type: 'invalid_request_error',
        code: 'token_invalidated',
        param: null
      }
    })
  };
}

function tokenRevokedResponse() {
  return {
    status: 401,
    body: JSON.stringify({
      error: {
        message: 'Encountered invalidated oauth token for user, failing request',
        type: null,
        code: 'token_revoked',
        param: null
      },
      status: 401
    })
  };
}

class FakeAccountManager implements AccountManagerGateway {
  requests: AccountRegistrationRequest[] = [];
  controls: string[] = [];
  private jobs: SubaccountRegistrationJobView[] = [];
  private requestTags = new Map<string, string>();

  async health() {
    return { status: 'ok', accountRegistrationConfigured: true };
  }

  async startRegistration(input: AccountRegistrationRequest): Promise<SubaccountRegistrationJobView> {
    this.requests.push(input);
    const job: SubaccountRegistrationJobView = {
      id: 'registration-job-1',
      status: 'queued',
      phase: 'registration_queued',
      message: '已加入账号注册队列',
      progress: 0,
      createdAt: 1,
      updatedAt: 1
    };
    this.jobs = [job];
    if (input.requestTag) this.requestTags.set(job.id, input.requestTag);
    return job;
  }

  async listRegistrations(requestTag?: string): Promise<SubaccountRegistrationJobView[]> {
    this.jobs = this.jobs.map((job) => job.status === 'queued' ? {
      ...job,
      status: 'succeeded',
      phase: 'registration_complete',
      message: '账号注册和 Session 交付已完成',
      progress: 100,
      email: 'registered-child@example.com',
      completedAt: 2,
      updatedAt: 2
    } : job);
    return requestTag
      ? this.jobs.filter((job) => this.requestTags.get(job.id) === requestTag)
      : this.jobs;
  }

  async listOperations(): Promise<AccountManagerOperationView[]> {
    return this.jobs.map((job) => this.operationFromJob(job));
  }

  async operation(id: string): Promise<AccountManagerOperationView> {
    const job = this.jobs.find((item) => item.id === id);
    if (!job) throw new Error('registration operation missing');
    return this.operationFromJob(job);
  }

  async listAccountOperations(): Promise<AccountManagerOperationView[]> {
    return [];
  }

  async retryRegistration(id: string): Promise<SubaccountRegistrationJobView> {
    const job = this.jobs.find((item) => item.id === id);
    if (!job) throw new Error('registration job missing');
    const queued = { ...job, status: 'queued' as const, progress: 0, phase: 'registration_queued' };
    this.jobs = [queued];
    return queued;
  }

  seedWaitingManualRegistration(): SubaccountRegistrationJobView {
    const job: SubaccountRegistrationJobView = {
      id: 'registration-manual-1',
      status: 'waiting_manual',
      phase: 'registration_stage_waiting_manual',
      message: '页面提交后暂未推进',
      progress: 95,
      email: 'manual-child@example.com',
      createdAt: 1,
      updatedAt: 1
    };
    this.jobs = [job];
    this.requestTags.set(job.id, ACCOUNT_MANAGER_REQUEST_TAGS.subaccount);
    return job;
  }

  async rotateOperationIp(id: string): Promise<AccountManagerOperationView> {
    const job = this.jobs.find((item) => item.id === id);
    if (!job) throw new Error('registration job missing');
    this.controls.push(`rotate:${id}`);
    const rotated = {
      ...job,
      phase: 'registration_manual_proxy_rotation_complete',
      message: 'IP已更换，正在继续监听当前页面',
      updatedAt: job.updatedAt + 1
    };
    this.jobs = [rotated];
    return this.operationFromJob(rotated);
  }

  async terminateOperation(id: string): Promise<AccountManagerOperationView> {
    throw new Error(`unexpected terminate: ${id}`);
  }

  async removeOperation(id: string): Promise<boolean> {
    const before = this.jobs.length;
    this.jobs = this.jobs.filter((job) => job.id !== id);
    return this.jobs.length !== before;
  }

  async session(accountId: string) {
    if (accountId !== 'registered-child@example.com') throw new Error('managed account missing');
    return {
      user: { email: 'registered-child@example.com' },
      account: { id: 'registered-child-chatgpt-account-id' },
      accessToken: chatGptWebAccessToken('registered-child-chatgpt-account-id', 'free'),
      sessionToken: 'registered-child-session-token'
    };
  }

  async account(accountId: string) {
    return { id: accountId, email: accountId, hasCodexSpace: false, workspaces: [] };
  }

  async syncAccount(accountId: string) {
    return this.account(accountId);
  }

  async openCodexSpace(
    accountId: string,
    _input: OpenCodexSpaceRequest & { requestTag?: string }
  ): Promise<AccountManagerOperationView> {
    return {
      id: 'codex-operation',
      accountId,
      type: 'open_codex_space',
      status: 'queued',
      phase: 'codex_queued',
      progress: 0,
      createdAt: 1,
      updatedAt: 1
    };
  }

  private operationFromJob(job: SubaccountRegistrationJobView): AccountManagerOperationView {
    return {
      id: job.id,
      ...(job.email ? { accountId: job.email, email: job.email } : {}),
      type: 'register',
      status: job.status,
      phase: job.phase,
      message: job.message,
      progress: job.progress,
      requestSummary: { requestTag: this.requestTags.get(job.id) },
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      ...(job.completedAt ? { completedAt: job.completedAt } : {}),
      ...(job.error ? { errorMessage: job.error } : {})
    };
  }
}


async function buildTestApp(options: { accountManager?: AccountManagerGateway } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'teammgr-subaccount-api-'));
  const config: AppConfig = {
    port: 0,
    dataDir: dir,
    jwtSecret: 'test-secret',
    jwtIssuer: 'team-manager',
    adminUsername: 'admin',
    adminPassword: 'password',
    allowedOrigins: [],
    webDistDir: join(dir, 'dist')
  };
  const store = new AccountStore(dir);
  await store.init();
  const mother = await store.add({
    accountId: 'workspace-account-id',
    email: 'owner@example.com',
    accessToken: 'mother-access-token'
  });
  const subaccountStore = new SubaccountStore(dir);
  await subaccountStore.init();
  const quotaTransport = new RecordingQuotaTransport();
  const teamTransport = new RecordingTeamTransport();
  const app = await buildApp({
    config,
    store,
    subaccountStore,
    subaccountQuotaTransport: quotaTransport,
    subaccountAccountManager: options.accountManager,
    teamTransport
  } as Parameters<typeof buildApp>[0]);

  const login = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'password' })
  });
  const loginJson = (await login.json()) as ApiResult<{ token: string }>;
  assert.equal(loginJson.ok, true);
  const token = loginJson.data!.token;
  const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  return { app, dir, store, subaccountStore, authHeaders, quotaTransport, teamTransport, mother };
}

async function waitForRegistrationJob(
  app: Awaited<ReturnType<typeof buildApp>>,
  authHeaders: Record<string, string>,
  jobId: string
): Promise<{ job: SubaccountRegistrationJobView; subaccount?: SubaccountView }> {
  const deadline = Date.now() + 2000;
  for (;;) {
    const jobsResponse = await app.request('/api/subaccounts/registration/jobs', { headers: authHeaders });
    const jobs = ((await jobsResponse.json()) as ApiResult<SubaccountRegistrationJobView[]>).data ?? [];
    const job = jobs.find((item) => item.id === jobId);
    if (job && !['queued', 'running'].includes(job.status)) {
      if (!job.subaccountId) return { job };
      const subaccountResponse = await app.request(`/api/subaccounts/${job.subaccountId}`, { headers: authHeaders });
      const subaccount = ((await subaccountResponse.json()) as ApiResult<SubaccountView>).data;
      return { job, subaccount };
    }
    if (Date.now() >= deadline) throw new Error(`等待自动注册任务超时: ${jobId}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('Subaccount API', () => {
  it('imports child session JSON and returns editable Web session views', async () => {
    const { app, dir, authHeaders } = await buildTestApp();
    try {
      const added = await app.request('/api/subaccounts/session', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          user: { email: 'child@example.com' },
          account: { id: 'child-chatgpt-account-id' },
          accessToken: 'child-web-access-token'
        })
      });
      const addedJson = (await added.json()) as ApiResult<SubaccountView>;

      assert.equal(added.status, 200);
      assert.equal(addedJson.data!.email, 'child@example.com');
      assert.equal(addedJson.data!.hasWebSession, true);
      assert.deepEqual(addedJson.data!.session, {
        user: { email: 'child@example.com' },
        account: { id: 'child-chatgpt-account-id' },
        accessToken: 'child-web-access-token'
      });

      const listed = await app.request('/api/subaccounts', { headers: authHeaders });
      const listedJson = (await listed.json()) as ApiResult<SubaccountSummaryView[]>;
      assert.equal(listedJson.data!.length, 1);
      assert.equal(listedJson.data![0]!.status, 'session_ready');
      assert.equal(Object.hasOwn(listedJson.data![0]!, 'session'), false);

      const profile = await app.request(`/api/subaccounts/${addedJson.data!.id}/local-profile`, { headers: authHeaders });
      const profileJson = (await profile.json()) as ApiResult<SubaccountLocalProfileView>;
      assert.equal(profileJson.data!.session?.accessToken, 'child-web-access-token');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('imports child session with the same local profile fields used by child profile editing', async () => {
    const { app, dir, authHeaders } = await buildTestApp();
    try {
      const added = await app.request('/api/subaccounts/session', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          remark: '  子号备注  ',
          proxy: '  socks5://child-proxy.example:1080  ',
          session: {
            user: { email: 'child-profile@example.com' },
            account: { id: 'child-chatgpt-account-id' },
            accessToken: 'child-web-access-token',
            sessionToken: 'child-session-token'
          }
        })
      });
      const body = await added.text();
      const addedJson = JSON.parse(body) as ApiResult<SubaccountView>;

      assert.equal(added.status, 200, body);
      assert.equal(addedJson.data!.email, 'child-profile@example.com');
      assert.equal(addedJson.data!.remark, '子号备注');
      assert.equal(addedJson.data!.proxy, 'socks5://child-proxy.example:1080');
      assert.deepEqual(addedJson.data!.session, {
        user: { email: 'child-profile@example.com' },
        account: { id: 'child-chatgpt-account-id' },
        accessToken: 'child-web-access-token',
        sessionToken: 'child-session-token'
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('refreshes a child Web Session and manages personal profile, common settings, and credits through local APIs', async () => {
    const { app, dir, authHeaders, teamTransport } = await buildTestApp();
    try {
      const freshToken = chatGptWebAccessToken('child-chatgpt-account-id', 'free');
      teamTransport.sessionAccessTokensByWorkspaceId.set('child-chatgpt-account-id', freshToken);
      const added = await app.request('/api/subaccounts/session', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          user: { email: 'child@example.com' },
          account: { id: 'child-chatgpt-account-id' },
          accessToken: 'stale-child-web-access-token',
          sessionToken: 'child-session-token'
        })
      });
      const subaccount = ((await added.json()) as ApiResult<SubaccountView>).data!;

      const refreshed = await app.request(`/api/subaccounts/${subaccount.id}/refresh`, {
        method: 'POST',
        headers: authHeaders
      });
      const refreshedBody = await refreshed.text();
      const refreshedJson = JSON.parse(refreshedBody) as ApiResult<SubaccountView>;

      assert.equal(refreshed.status, 200, refreshedBody);
      assert.equal(refreshedJson.data!.sessionTokenStatus, 'valid');
      assert.equal(refreshedJson.data!.webAccessTokenStatus, 'valid');
      assert.equal(refreshedJson.data!.session?.accessToken, freshToken);
      assert.equal(refreshedJson.data!.chatgptUserId, 'user-child');
      assert.equal(refreshedJson.data!.remoteUsername, 'child-user');
      assert.equal(refreshedJson.data!.remoteDisplayName, 'Child User');
      assert.equal(refreshedJson.data!.remotePictureUrl, 'https://example.invalid/child.png');
      assert.equal(refreshedJson.data!.marketingPushEnabled, true);
      assert.equal(refreshedJson.data!.marketingEmailEnabled, false);
      assert.equal(refreshedJson.data!.rateLimitResetCredits?.availableCount, 2);
      assert.equal(refreshedJson.data!.rateLimitResetCredits?.totalEarnedCount, 3);
      assert.equal(refreshedJson.data!.lastError, undefined);

      const meRequest = teamTransport.requests.find((request) => request.path === '/backend-api/me');
      assert.equal(meRequest?.headers.Authorization, `Bearer ${freshToken}`);
      assert.equal(meRequest?.headers['chatgpt-account-id'], 'child-chatgpt-account-id');
      assert.equal(Boolean(meRequest?.headers['oai-device-id']), true);
      assert.equal(Boolean(meRequest?.headers['oai-session-id']), true);

      const marketingChanged = await app.request(`/api/subaccounts/${subaccount.id}/personal-settings`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ marketingPushEnabled: false, marketingEmailEnabled: true })
      });
      const marketingJson = (await marketingChanged.json()) as ApiResult<SubaccountView>;
      assert.equal(marketingChanged.status, 200);
      assert.equal(marketingJson.data!.marketingPushEnabled, false);
      assert.equal(marketingJson.data!.marketingEmailEnabled, true);

      const memoryChanged = await app.request(`/api/subaccounts/${subaccount.id}/personal-settings`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ memoryEnabled: false })
      });
      const memoryJson = (await memoryChanged.json()) as ApiResult<SubaccountView>;
      assert.equal(memoryChanged.status, 200);
      assert.equal(memoryJson.data!.memoryEnabled, false);

      const profileChanged = await app.request(`/api/subaccounts/${subaccount.id}/personal-settings`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ username: 'new-child-user', displayName: 'New Child User' })
      });
      const profileJson = (await profileChanged.json()) as ApiResult<SubaccountView>;
      assert.equal(profileChanged.status, 200);
      assert.equal(profileJson.data!.remoteUsername, 'new-child-user');
      assert.equal(profileJson.data!.remoteDisplayName, 'New Child User');

      const marketingRequest = teamTransport.requests.find(
        (request) => request.method === 'PATCH' && request.path === '/backend-api/notifications/settings'
      );
      assert.deepEqual(JSON.parse(marketingRequest?.body ?? '{}'), {
        updates: { marketing: { push: false, email: true } }
      });

      const logs = await app.request(`/api/subaccounts/${subaccount.id}/logs`, { headers: authHeaders });
      const logsJson = (await logs.json()) as ApiResult<Array<{ phase: string; data?: Record<string, unknown> }>>;
      const refreshLog = logsJson.data!.find((entry) => entry.phase === 'web_account_refresh');
      assert.equal((refreshLog?.data?.session as Record<string, unknown>)?.accessToken, freshToken);
      assert.equal(Boolean(refreshLog?.data?.me), true);
      assert.equal(Boolean(refreshLog?.data?.profile), true);
      assert.equal(Boolean(refreshLog?.data?.notifications), true);
      assert.equal(Boolean(refreshLog?.data?.rateLimitResetCredits), true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('does not flag an otherwise healthy free account when the optional profile endpoint requires an organization', async () => {
    const { app, dir, authHeaders, teamTransport } = await buildTestApp();
    try {
      const freshToken = chatGptWebAccessToken('personal-free-account-id', 'free');
      teamTransport.sessionAccessTokensByWorkspaceId.set('personal-free-account-id', freshToken);
      teamTransport.personalProfileUnavailable = true;
      const added = await app.request('/api/subaccounts/session', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          user: { email: 'child@example.com' },
          account: { id: 'personal-free-account-id' },
          accessToken: 'stale-free-child-token',
          sessionToken: 'free-child-session-token'
        })
      });
      const subaccount = ((await added.json()) as ApiResult<SubaccountView>).data!;

      const refreshed = await app.request(`/api/subaccounts/${subaccount.id}/refresh`, {
        method: 'POST',
        headers: authHeaders
      });
      const refreshedBody = await refreshed.text();
      const refreshedJson = JSON.parse(refreshedBody) as ApiResult<SubaccountView>;

      assert.equal(refreshed.status, 200, refreshedBody);
      assert.equal(refreshedJson.data!.sessionTokenStatus, 'valid');
      assert.equal(refreshedJson.data!.webAccessTokenStatus, 'valid');
      assert.equal(refreshedJson.data!.lastError, undefined);
      assert.equal(refreshedJson.data!.remoteDisplayName, 'Child User');
      assert.equal(refreshedJson.data!.remoteUsername, undefined);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('persists a valid Session Cookie and an invalid Web AT as separate child sync results', async () => {
    const { app, dir, authHeaders, teamTransport, subaccountStore } = await buildTestApp();
    try {
      const revokedToken = chatGptWebAccessToken('child-chatgpt-account-id', 'free');
      teamTransport.sessionAccessTokensByWorkspaceId.set('child-chatgpt-account-id', revokedToken);
      teamTransport.invalidatedAccessTokens.add(revokedToken);
      const added = await app.request('/api/subaccounts/session', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          user: { email: 'child@example.com' },
          account: { id: 'child-chatgpt-account-id' },
          accessToken: 'stale-child-web-access-token',
          sessionToken: 'child-session-token'
        })
      });
      const subaccount = ((await added.json()) as ApiResult<SubaccountView>).data!;
      await subaccountStore.update(subaccount.id, { status: 'error', lastError: 'earlier operation failed' });

      const refreshed = await app.request(`/api/subaccounts/${subaccount.id}/refresh`, {
        method: 'POST',
        headers: authHeaders
      });
      const body = await refreshed.text();
      const json = JSON.parse(body) as ApiResult<SubaccountView>;

      assert.equal(refreshed.status, 200, body);
      assert.equal(json.data!.sessionTokenStatus, 'valid');
      assert.equal(json.data!.webAccessTokenStatus, 'invalid');
      assert.equal(json.data!.status, 'session_ready');
      assert.match(json.data!.lastError ?? '', /token_invalidated/);
      assert.equal(typeof json.data!.lastRefreshAt, 'number');

      const detail = await app.request(`/api/subaccounts/${subaccount.id}`, { headers: authHeaders });
      const detailJson = (await detail.json()) as ApiResult<SubaccountView>;
      assert.equal(detailJson.data!.sessionTokenStatus, 'valid');
      assert.equal(detailJson.data!.webAccessTokenStatus, 'invalid');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('refreshes and retries a child personal setting when the saved Web AT returns token_revoked', async () => {
    const { app, dir, authHeaders, teamTransport } = await buildTestApp();
    try {
      const staleToken = 'revoked-child-web-access-token';
      const freshToken = chatGptWebAccessToken('child-chatgpt-account-id', 'free');
      teamTransport.revokedAccessTokens.add(staleToken);
      teamTransport.sessionAccessTokensByWorkspaceId.set('child-chatgpt-account-id', freshToken);
      const added = await app.request('/api/subaccounts/session', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          user: { email: 'child@example.com' },
          account: { id: 'child-chatgpt-account-id' },
          accessToken: staleToken,
          sessionToken: 'child-session-token'
        })
      });
      const subaccount = ((await added.json()) as ApiResult<SubaccountView>).data!;

      const refreshed = await app.request(`/api/subaccounts/${subaccount.id}/personal-settings`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ marketingPushEnabled: false })
      });
      const body = await refreshed.text();
      const json = JSON.parse(body) as ApiResult<SubaccountView>;

      assert.equal(refreshed.status, 200, body);
      assert.equal(json.data!.session?.accessToken, freshToken);
      assert.equal(json.data!.sessionTokenStatus, 'valid');
      assert.equal(json.data!.webAccessTokenStatus, 'valid');
      assert.equal(json.data!.marketingPushEnabled, false);
      const notificationRequests = teamTransport.requests.filter(
        (request) => request.path === '/backend-api/notifications/settings'
      );
      assert.deepEqual(
        notificationRequests.map((request) => request.headers.Authorization),
        [`Bearer ${staleToken}`, `Bearer ${freshToken}`]
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('updates child proxy, returns editable session JSON, and uses that proxy for child Team requests', async () => {
    const { app, dir, subaccountStore, authHeaders, mother, teamTransport } = await buildTestApp();
    try {
      teamTransport.accountsCheckByAccessToken.set('child-web-access-token', {
        'workspace-account-id': {
          account: {
            account_id: 'workspace-account-id',
            account_user_role: 'standard-user',
            name: 'Team A',
            plan_type: 'team',
            structure: 'workspace'
          },
          can_access_with_session: true
        }
      });
      const added = await app.request('/api/subaccounts/session', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          user: { email: 'child@example.com' },
          account: { id: 'child-chatgpt-account-id' },
          accessToken: 'child-web-access-token',
          sessionToken: 'child-session-json-token'
        })
      });
      const subaccount = ((await added.json()) as ApiResult<SubaccountView>).data!;

      const updated = await app.request(`/api/subaccounts/${subaccount.id}/local-profile`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({
          groupName: '  客户 A  ',
          proxy: '  socks5://child-proxy.example:1080  '
        })
      });
      const updatedJson = (await updated.json()) as ApiResult<SubaccountView>;
      const view = updatedJson.data as unknown as Record<string, any>;

      assert.equal(updated.status, 200);
      assert.equal(view.groupName, '客户 A');
      assert.equal(view.proxy, 'socks5://child-proxy.example:1080');
      assert.deepEqual(view.session, {
        user: { email: 'child@example.com' },
        account: { id: 'child-chatgpt-account-id' },
        accessToken: 'child-web-access-token',
        sessionToken: 'child-session-json-token'
      });
      assert.equal((subaccountStore.get(subaccount.id) as any)?.proxy, 'socks5://child-proxy.example:1080');
      assert.equal(subaccountStore.get(subaccount.id)?.groupName, '客户 A');

      const synced = await app.request(`/api/subaccounts/${subaccount.id}/team-links/sync`, {
        method: 'POST',
        headers: authHeaders
      });
      const syncedJson = (await synced.json()) as ApiResult<SubaccountView>;

      assert.equal(synced.status, 200);
      assert.equal(syncedJson.data!.teamLinks.find((link) => link.accountId === mother.id)?.status, 'member');
      assert.equal(teamTransport.requests.length, 1);
      assert.deepEqual(
        teamTransport.requests.map((request) => (request as any).proxy),
        ['socks5://child-proxy.example:1080']
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects array input for child session import', async () => {
    const { app, dir, authHeaders } = await buildTestApp();
    try {
      const added = await app.request('/api/subaccounts/session', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify([
          { name: 'session-cookie-0', value: 'session-token-0' },
          { name: 'session-cookie-1', value: 'session-token-1' }
        ])
      });
      const addedJson = (await added.json()) as ApiResult;

      assert.equal(added.status, 400);
      assert.equal(addedJson.ok, false);
      assert.equal(addedJson.error, '只支持 chatgpt.com session JSON，不支持数组输入');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });


  it('returns 400 for unsupported child session JSON shapes', async () => {
    const { app, dir, authHeaders } = await buildTestApp();
    try {
      const response = await app.request('/api/subaccounts/session', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ email: 'child@example.com', accessToken: 'token' })
      });
      const json = (await response.json()) as ApiResult;

      assert.equal(response.status, 400);
      assert.equal(json.ok, false);
      assert.equal(json.error, '缺少 user.email');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('updates only the child local remark while preserving credentials and Team links', async () => {
    const { app, dir, subaccountStore, authHeaders, mother } = await buildTestApp();
    try {
      const added = await app.request('/api/subaccounts/session', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          user: { email: 'child@example.com' },
          account: { id: 'child-chatgpt-account-id' },
          accessToken: 'child-web-access-token'
        })
      });
      const subaccount = ((await added.json()) as ApiResult<SubaccountView>).data!;
      await subaccountStore.saveCodexCredential(subaccount.id, patCredential('workspace-account-id'));
      await subaccountStore.saveTeamLink(subaccount.id, {
        accountId: mother.id,
        seat: 'usage_based',
        status: 'member'
      });

      const updated = await app.request(`/api/subaccounts/${subaccount.id}/local-profile`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ remark: '  子号备注  ' })
      });
      const body = await updated.text();
      const updatedJson = JSON.parse(body) as ApiResult<SubaccountView>;
      const stored = subaccountStore.get(subaccount.id);
      const viewRecord = updatedJson.data as unknown as Record<string, unknown>;

      assert.equal(updated.status, 200, body);
      assert.equal(updatedJson.data!.remark, '子号备注');
      assert.equal(hasOwn(viewRecord, 'label'), false);
      assert.equal(updatedJson.data!.email, 'child@example.com');
      assert.equal(updatedJson.data!.codexCredentials.length, 1);
      assert.equal(updatedJson.data!.teamLinks.length, 1);
      assert.equal(updatedJson.data!.status, 'codex_ready');
      assert.equal(stored?.webAccessToken, 'child-web-access-token');
      assert.equal(updatedJson.data!.session?.accessToken, 'child-web-access-token');
      assert.equal(body.includes('codex-access-token'), false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('updates child local session fields and returns editable session JSON', async () => {
    const { app, dir, subaccountStore, authHeaders } = await buildTestApp();
    try {
      const added = await app.request('/api/subaccounts/session', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          user: { email: 'child@example.com' },
          account: { id: 'child-chatgpt-account-id' },
          accessToken: 'child-web-access-token'
        })
      });
      const subaccount = ((await added.json()) as ApiResult<SubaccountView>).data!;
      await subaccountStore.update(subaccount.id, {
        status: 'error',
        lastError: '旧 session 失效',
        sessionToken: 'stale-session-token'
      });

      const updated = await app.request(`/api/subaccounts/${subaccount.id}/local-profile`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({
          remark: '新子号',
          session: {
            user: { email: 'child-new@example.com' },
            account: { id: 'child-chatgpt-account-new' },
            accessToken: 'child-new-web-access-token'
          }
        })
      });
      const body = await updated.text();
      const updatedJson = JSON.parse(body) as ApiResult<SubaccountView>;
      const stored = subaccountStore.get(subaccount.id);

      assert.equal(updated.status, 200);
      assert.equal(updatedJson.data!.remark, '新子号');
      assert.equal(updatedJson.data!.email, 'child-new@example.com');
      assert.equal(updatedJson.data!.chatgptAccountId, 'child-chatgpt-account-new');
      assert.equal(updatedJson.data!.lastError, undefined);
      assert.equal(stored?.email, 'child-new@example.com');
      assert.equal(stored?.chatgptAccountId, 'child-chatgpt-account-new');
      assert.equal(stored?.webAccessToken, 'child-new-web-access-token');
      assert.equal(stored?.sessionToken, undefined);
      assert.equal(stored?.lastError, undefined);
      assert.deepEqual(updatedJson.data!.session, {
        user: { email: 'child-new@example.com' },
        account: { id: 'child-chatgpt-account-new' },
        accessToken: 'child-new-web-access-token'
      });
      assert.equal(body.includes('stale-session-token'), false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects array input for child local session replacement', async () => {
    const { app, dir, authHeaders } = await buildTestApp();
    try {
      const added = await app.request('/api/subaccounts/session', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          user: { email: 'child@example.com' },
          account: { id: 'child-chatgpt-account-id' },
          accessToken: 'child-web-access-token'
        })
      });
      const subaccount = ((await added.json()) as ApiResult<SubaccountView>).data!;

      const updated = await app.request(`/api/subaccounts/${subaccount.id}/local-profile`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({
          remark: '子号备注',
          session: [
            { name: 'session-cookie-0', value: 'session-token-0' },
            { name: 'session-cookie-1', value: 'session-token-1' }
          ]
        })
      });
      const updatedJson = (await updated.json()) as ApiResult;

      assert.equal(updated.status, 400);
      assert.equal(updatedJson.ok, false);
      assert.equal(updatedJson.error, '只支持 chatgpt.com session JSON，不支持数组输入');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns 400 for invalid replacement child session JSON', async () => {
    const { app, dir, authHeaders } = await buildTestApp();
    try {
      const added = await app.request('/api/subaccounts/session', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          user: { email: 'child@example.com' },
          account: { id: 'child-chatgpt-account-id' },
          accessToken: 'child-web-access-token'
        })
      });
      const subaccount = ((await added.json()) as ApiResult<SubaccountView>).data!;

      const response = await app.request(`/api/subaccounts/${subaccount.id}/local-profile`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({
          remark: '新子号',
          session: { email: 'child-new@example.com', accessToken: 'child-new-web-access-token' }
        })
      });
      const json = (await response.json()) as ApiResult;

      assert.equal(response.status, 400, JSON.stringify(json));
      assert.equal(json.ok, false);
      assert.equal(json.error, '缺少 user.email');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('creates a Codex personal access token credential with the child Web session', async () => {
    const { app, dir, authHeaders, teamTransport } = await buildTestApp();
    try {
      const added = await app.request('/api/subaccounts/session', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          user: { email: 'child@example.com' },
          account: { id: 'child-chatgpt-account-id' },
          accessToken: 'child-web-access-token'
        })
      });
      const subaccount = ((await added.json()) as ApiResult<SubaccountView>).data!;

      const created = await app.request(`/api/subaccounts/${subaccount.id}/pat-credentials`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ chatgptAccountId: 'workspace-account-id' })
      });
      const body = await created.text();
      const createdJson = JSON.parse(body) as ApiResult<SubaccountView>;

      assert.equal(created.status, 200, body);
      assert.equal(createdJson.data!.status, 'codex_ready');
      assert.equal(createdJson.data!.codexCredentials[0]!.accountId, 'workspace-account-id');

      const request = teamTransport.requests.find((item) => item.path === '/backend-api/wham/auth-credentials');
      assert.equal(request?.method, 'POST');
      assert.equal(request?.headers.Authorization, 'Bearer child-web-access-token');
      assert.equal(request?.headers['chatgpt-account-id'], 'workspace-account-id');
      assert.deepEqual(JSON.parse(request!.body!), {
        name: 'team-manager',
        scopes: ['chatgpt.workspace.feature.allow-codex-local-access.access'],
        ttl: 2592000
      });

      const exported = await app.request(
        `/api/subaccounts/${subaccount.id}/pat-credentials?chatgptAccountId=workspace-account-id`,
        { headers: authHeaders }
      );
      const exportedJson = (await exported.json()) as ApiResult<Record<string, unknown>>;
      assert.equal(exportedJson.data!.access_token, 'at-generated-codex-token');
      assert.equal(exportedJson.data!.personal_access_token, 'at-generated-codex-token');
      assert.equal(exportedJson.data!.account_id, 'workspace-account-id');
      assert.equal(exportedJson.data!.email, 'child@example.com');
      assert.equal(exportedJson.data!.type, 'codex');
      assert.equal(exportedJson.data!.auth_mode, 'personalAccessToken');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uses sessionToken from ChatGPT session JSON to mint a workspace-scoped Web access token before creating a personal access token', async () => {
    const { app, dir, authHeaders, teamTransport, subaccountStore } = await buildTestApp();
    try {
      teamTransport.currentSessionAccountId = 'personal-account-id';
      const workspaceWebAccessToken = chatGptWebAccessToken('workspace-account-id');
      teamTransport.sessionAccessTokensByWorkspaceId.set('workspace-account-id', workspaceWebAccessToken);
      const added = await app.request('/api/subaccounts/session', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          user: { email: 'child@example.com' },
          account: { id: 'personal-account-id' },
          accessToken: chatGptWebAccessToken('personal-account-id', 'free'),
          sessionToken: 'child-session-json-token'
        })
      });
      const addBody = await added.text();
      const subaccount = (JSON.parse(addBody) as ApiResult<SubaccountView>).data!;
      const stored = subaccountStore.get(subaccount.id);

      assert.equal(added.status, 200, addBody);
      assert.equal(stored?.sessionToken, 'child-session-json-token');
      assert.equal(subaccount.session?.sessionToken, 'child-session-json-token');

      const created = await app.request(`/api/subaccounts/${subaccount.id}/pat-credentials`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ chatgptAccountId: 'workspace-account-id' })
      });
      const body = await created.text();
      const createdJson = JSON.parse(body) as ApiResult<SubaccountView>;

      assert.equal(created.status, 200, body);
      assert.equal(createdJson.data!.codexCredentials[0]!.accountId, 'workspace-account-id');

      const sessionRequest = teamTransport.requests.find(
        (item) => item.path.startsWith('/api/auth/session') && (item.headers.cookie ?? '').includes('_account=workspace-account-id')
      );
      assert.equal(sessionRequest?.method, 'GET');
      assert.match(sessionRequest?.headers.cookie ?? '', /_account=workspace-account-id/);
      assert.match(
        sessionRequest?.headers.cookie ?? '',
        /__Secure-next-auth\.session-token=child-session-json-token/
      );

      const tokenRequest = teamTransport.requests.find((item) => item.path === '/backend-api/wham/auth-credentials');
      assert.equal(tokenRequest?.headers.Authorization, `Bearer ${workspaceWebAccessToken}`);
      assert.equal(tokenRequest?.headers['chatgpt-account-id'], 'workspace-account-id');
      assert.equal(createdJson.data!.session?.sessionToken, 'child-session-json-token');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects a generated personal access token when ChatGPT returns a different workspace', async () => {
    const { app, dir, authHeaders, teamTransport } = await buildTestApp();
    try {
      teamTransport.personalAccessTokenWorkspaceId = 'other-workspace-id';
      const added = await app.request('/api/subaccounts/session', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          user: { email: 'child@example.com' },
          account: { id: 'child-chatgpt-account-id' },
          accessToken: 'child-web-access-token'
        })
      });
      const subaccount = ((await added.json()) as ApiResult<SubaccountView>).data!;

      const created = await app.request(`/api/subaccounts/${subaccount.id}/pat-credentials`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ chatgptAccountId: 'workspace-account-id' })
      });
      const createdText = await created.text();
      const createdJson = JSON.parse(createdText) as ApiResult;

      assert.equal(created.status, 409, createdText);
      assert.match(createdJson.error ?? '', /workspace 与目标不一致/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('refreshes Codex quota by querying usage with the generated credential', async () => {
    const { app, dir, authHeaders, quotaTransport } = await buildTestApp();
    try {
      const added = await app.request('/api/subaccounts/session', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          user: { email: 'child@example.com' },
          account: { id: 'child-chatgpt-account-id' },
          accessToken: 'child-web-access-token'
        })
      });
      const subaccount = ((await added.json()) as ApiResult<SubaccountView>).data!;
      await app.request(`/api/subaccounts/${subaccount.id}/local-profile`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ proxy: 'http://quota-proxy.example:8080' })
      });
      const created = await app.request(`/api/subaccounts/${subaccount.id}/pat-credentials`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ chatgptAccountId: 'workspace-account-id' })
      });
      assert.equal(created.status, 200);

      const refreshed = await app.request(`/api/subaccounts/${subaccount.id}/quota/refresh`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ chatgptAccountId: 'workspace-account-id' })
      });
      const refreshedJson = (await refreshed.json()) as ApiResult<{
        status: string;
        windows: Array<{ id: string; usedPercent: number }>;
      }>;

      assert.equal(refreshedJson.data!.status, 'success');
      assert.equal(refreshedJson.data!.windows[0]!.id, 'code-five-hour');
      assert.equal(refreshedJson.data!.windows[0]!.usedPercent, 28);
      assert.equal(quotaTransport.requests[0]!.path, '/backend-api/wham/usage');
      assert.equal(quotaTransport.requests[0]!.headers.Authorization, 'Bearer at-generated-codex-token');
      assert.equal(quotaTransport.requests[0]!.headers['Chatgpt-Account-Id'], 'workspace-account-id');
      assert.equal((quotaTransport.requests[0] as any).proxy, 'http://quota-proxy.example:8080');

      const detail = await app.request(`/api/subaccounts/${subaccount.id}`, { headers: authHeaders });
      const detailJson = (await detail.json()) as ApiResult<SubaccountView>;
      assert.equal(detailJson.data!.codexCredentials[0]!.lastQuota?.windows[0]!.usedPercent, 28);
      assert.equal(typeof detailJson.data!.codexCredentials[0]!.lastQuotaAt, 'number');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('imports an Account Manager session exactly once without copying password or profile data', async () => {
    const accountManager = new FakeAccountManager();
    const { app, dir, authHeaders, subaccountStore } = await buildTestApp({ accountManager });
    try {
      const started = await app.request('/api/subaccounts/registration/start', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ mailGroup: 'clean-outlook' })
      });
      assert.equal(started.status, 200);
      const startedJson = (await started.json()) as ApiResult<SubaccountRegistrationJobView>;
      assert.equal(startedJson.data!.status, 'queued');
      const completed = await waitForRegistrationJob(app, authHeaders, startedJson.data!.id);
      const registered = completed.subaccount!;
      assert.equal(completed.job.status, 'succeeded');
      assert.equal(registered.email, 'registered-child@example.com');
      assert.equal(registered.status, 'session_ready');
      assert.equal(registered.hasWebSession, true);
      assert.equal(Object.hasOwn(registered, 'session'), false);
      assert.equal(registered.managedAccountEmail, 'registered-child@example.com');
      assert.equal(registered.codexCredentials.length, 0);
      assert.equal(accountManager.requests[0]!.mailGroup, 'clean-outlook');

      const profileResponse = await app.request(`/api/subaccounts/${registered.id}/local-profile`, { headers: authHeaders });
      const profile = ((await profileResponse.json()) as ApiResult<SubaccountLocalProfileView>).data!;
      assert.equal(profile.session?.sessionToken, 'registered-child-session-token');

      const stored = subaccountStore.get(registered.id) as unknown as Record<string, unknown>;
      assert.equal(Object.hasOwn(stored, 'registrationPassword'), false);
      assert.equal(Object.hasOwn(stored, 'cloakProfileId'), false);

      const allLogs = await app.request(`/api/subaccounts/${registered.id}/logs`, { headers: authHeaders });
      const allLogsJson = (await allLogs.json()) as ApiResult<Array<{ phase: string; message: string }>>;
      assert.ok(allLogsJson.data!.some((log) => log.phase === 'account_manager_session_import'));
      assert.equal(JSON.stringify(allLogsJson).includes('generated-child-password'), false);

      const jobsAfterImport = await app.request('/api/subaccounts/registration/jobs', { headers: authHeaders });
      const jobsAfterImportJson = (await jobsAfterImport.json()) as ApiResult<SubaccountRegistrationJobView[]>;
      assert.equal(jobsAfterImportJson.data!.length, 0);
      assert.equal(subaccountStore.list().length, 1);

      const removed = await app.request(`/api/subaccounts/${registered.id}`, {
        method: 'DELETE',
        headers: authHeaders
      });
      assert.equal(removed.status, 200);
      const jobsAfterDelete = await app.request('/api/subaccounts/registration/jobs', { headers: authHeaders });
      const jobsAfterDeleteJson = (await jobsAfterDelete.json()) as ApiResult<SubaccountRegistrationJobView[]>;
      assert.equal(jobsAfterDeleteJson.data!.some((job) => job.id === completed.job.id), false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rotates IP for a child registration waiting at any manual stage', async () => {
    const accountManager = new FakeAccountManager();
    const job = accountManager.seedWaitingManualRegistration();
    const { app, dir, authHeaders } = await buildTestApp({ accountManager });
    try {
      const response = await app.request(`/api/subaccounts/registration/jobs/${job.id}/rotate-ip`, {
        method: 'POST',
        headers: authHeaders
      });
      const body = (await response.json()) as ApiResult<SubaccountRegistrationJobView>;

      assert.equal(response.status, 200);
      assert.equal(body.data!.status, 'waiting_manual');
      assert.equal(body.data!.phase, 'registration_manual_proxy_rotation_complete');
      assert.deepEqual(accountManager.controls, [`rotate:${job.id}`]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('invites a child account into a selected mother account and records the local link', async () => {
    const { app, dir, authHeaders, mother, teamTransport } = await buildTestApp();
    try {
      const added = await app.request('/api/subaccounts/session', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          user: { email: 'child@example.com' },
          account: { id: 'child-chatgpt-account-id' },
          accessToken: 'child-web-access-token'
        })
      });
      const subaccount = ((await added.json()) as ApiResult<SubaccountView>).data!;

      const invited = await app.request(`/api/subaccounts/${subaccount.id}/team-invites`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ accountId: mother.id, seat: 'usage_based' })
      });
      const invitedJson = (await invited.json()) as ApiResult<SubaccountView>;
      const inviteRequest = teamTransport.requests.find((request) => request.method === 'POST');

      assert.equal(invited.status, 200);
      assert.equal(inviteRequest?.path, '/backend-api/accounts/workspace-account-id/invites');
      assert.deepEqual(JSON.parse(inviteRequest!.body!), {
        email_addresses: ['child@example.com'],
        role: 'standard-user',
        seat_type: 'usage_based',
        resend_emails: true
      });
      assert.equal(teamTransport.requests.length, 1);
      assert.equal(invitedJson.data!.teamLinks[0]!.accountId, mother.id);
      assert.deepEqual(Object.keys(invitedJson.data!.teamLinks[0]!).sort(), [
        'accountId',
        'seat',
        'status',
        'updatedAt'
      ]);
      assert.equal(invitedJson.data!.teamLinks[0]!.seat, 'usage_based');
      assert.equal(invitedJson.data!.teamLinks[0]!.status, 'invited');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('lets a child account leave a Team using the child Web session instead of mother credentials', async () => {
    const { app, dir, store, subaccountStore, authHeaders, mother, teamTransport } = await buildTestApp();
    try {
      const childToken = chatGptWebAccessToken('child-chatgpt-account-id');
      const added = await app.request('/api/subaccounts/session', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          user: { email: 'child@example.com' },
          account: { id: 'child-chatgpt-account-id' },
          accessToken: childToken
        })
      });
      const subaccount = ((await added.json()) as ApiResult<SubaccountView>).data!;
      await subaccountStore.saveTeamLink(subaccount.id, {
        accountId: mother.id,
        workspaceId: 'workspace-account-id',
        workspaceName: 'Team A',
        seat: 'default',
        status: 'member'
      });

      const left = await app.request(`/api/subaccounts/${subaccount.id}/team-links/workspace-account-id`, {
        method: 'DELETE',
        headers: authHeaders
      });
      const leftJson = (await left.json()) as ApiResult<SubaccountView>;
      const deleteRequests = teamTransport.requests.filter((request) => request.method === 'DELETE');

      assert.equal(left.status, 200);
      assert.equal(leftJson.data!.teamLinks.length, 0);
      assert.equal(deleteRequests.length, 1);
      assert.equal(deleteRequests[0]!.path, '/backend-api/accounts/workspace-account-id/users/user-child');
      assert.equal(deleteRequests[0]!.headers.Authorization, `Bearer ${childToken}`);
      assert.equal(deleteRequests[0]!.headers['chatgpt-account-id'], 'workspace-account-id');
      assert.equal(
        deleteRequests.some((request) => request.headers.Authorization === 'Bearer mother-access-token'),
        false
      );
      assert.equal(store.get(mother.id)?.accessToken, 'mother-access-token');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('syncs child Team links from the child visible workspace list without scanning every mother', async () => {
    const { app, dir, store, authHeaders, mother, teamTransport } = await buildTestApp();
    try {
      const linkedMother = await store.add({
        accountId: 'workspace-account-b',
        email: 'owner-b@example.com',
        accessToken: 'mother-b-access-token'
      });
      await store.add({
        accountId: 'workspace-account-c',
        email: 'owner-c@example.com',
        accessToken: 'mother-c-access-token'
      });
      teamTransport.accountsCheckByAccessToken.set('child-web-access-token', {
        'workspace-account-id': {
          account: {
            account_id: 'workspace-account-id',
            account_user_role: 'standard-user',
            name: 'Team A',
            plan_type: 'team'
          }
        },
        'workspace-account-b': {
          account: {
            account_id: 'workspace-account-b',
            account_user_role: 'standard-user',
            name: 'Team B',
            plan_type: 'team'
          }
        },
        'child-chatgpt-account-id': {
          account: {
            account_id: 'child-chatgpt-account-id',
            account_user_role: 'account-owner',
            name: 'Personal',
            plan_type: 'free'
          }
        }
      });
      const added = await app.request('/api/subaccounts/session', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          user: { email: 'child@example.com' },
          account: { id: 'child-chatgpt-account-id' },
          accessToken: 'child-web-access-token'
        })
      });
      const subaccount = ((await added.json()) as ApiResult<SubaccountView>).data!;

      const synced = await app.request(`/api/subaccounts/${subaccount.id}/team-links/sync`, {
        method: 'POST',
        headers: authHeaders
      });
      const syncedJson = (await synced.json()) as ApiResult<SubaccountView>;
      const links = new Map(syncedJson.data!.teamLinks.map((link) => [link.accountId, link]));

      assert.equal(synced.status, 200);
      assert.equal(links.size, 2);
      assert.equal(links.get(mother.id)!.status, 'member');
      assert.equal(links.get(linkedMother.id)!.status, 'member');
      assert.equal(links.has('workspace-account-c'), false);
      assert.deepEqual(
        teamTransport.requests.map((request) => request.path),
        [
          '/backend-api/accounts/check/v4-2023-04-27?timezone_offset_min=-480'
        ]
      );
      assert.equal(teamTransport.requests[0]!.headers.Authorization, 'Bearer child-web-access-token');
      assert.equal(teamTransport.requests[0]!.headers['chatgpt-account-id'], 'child-chatgpt-account-id');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps child-visible Team workspaces that are not saved as local mother accounts', async () => {
    const { app, dir, authHeaders, mother, teamTransport } = await buildTestApp();
    try {
      teamTransport.accountsCheckByAccessToken.set('child-web-access-token', {
        'workspace-account-id': {
          account: {
            account_id: 'workspace-account-id',
            account_user_role: 'standard-user',
            name: 'Team A',
            plan_type: 'team'
          }
        },
        'external-workspace-id': {
          account: {
            account_id: 'external-workspace-id',
            account_user_role: 'standard-user',
            name: 'External Team',
            plan_type: 'team'
          }
        }
      });
      const added = await app.request('/api/subaccounts/session', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          user: { email: 'child@example.com' },
          account: { id: 'child-chatgpt-account-id' },
          accessToken: 'child-web-access-token'
        })
      });
      const subaccount = ((await added.json()) as ApiResult<SubaccountView>).data!;

      const synced = await app.request(`/api/subaccounts/${subaccount.id}/team-links/sync`, {
        method: 'POST',
        headers: authHeaders
      });
      const syncedJson = (await synced.json()) as ApiResult<SubaccountView>;
      const linksByWorkspaceId = new Map(syncedJson.data!.teamLinks.map((link) => [link.workspaceId, link]));

      assert.equal(synced.status, 200);
      assert.equal(linksByWorkspaceId.size, 2);
      assert.equal(linksByWorkspaceId.get('workspace-account-id')!.accountId, mother.id);
      assert.equal(linksByWorkspaceId.get('external-workspace-id')!.accountId, 'external-workspace-id');
      assert.equal(linksByWorkspaceId.get('external-workspace-id')!.workspaceName, 'External Team');
      assert.equal(linksByWorkspaceId.get('external-workspace-id')!.planType, 'team');
      assert.equal(linksByWorkspaceId.get('external-workspace-id')!.role, 'standard-user');
      assert.equal(linksByWorkspaceId.get('external-workspace-id')!.seat, 'usage_based');
      assert.equal(linksByWorkspaceId.get('external-workspace-id')!.status, 'member');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('refreshes an invalidated child Web access token from saved sessionToken while syncing Team links', async () => {
    const { app, dir, store, subaccountStore, authHeaders, mother, teamTransport } = await buildTestApp();
    try {
      const refreshedToken = chatGptWebAccessToken('child-chatgpt-account-id', 'free');
      teamTransport.invalidatedAccessTokens.add('stale-child-web-access-token');
      teamTransport.sessionAccessTokensByWorkspaceId.set('child-chatgpt-account-id', refreshedToken);
      teamTransport.accountsCheckByAccessToken.set(refreshedToken, {
        'workspace-account-id': {
          account: {
            account_id: 'workspace-account-id',
            account_user_role: 'standard-user',
            name: 'Team A',
            plan_type: 'team'
          }
        }
      });
      const added = await app.request('/api/subaccounts/session', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          user: { email: 'child@example.com' },
          account: { id: 'child-chatgpt-account-id' },
          accessToken: 'stale-child-web-access-token',
          sessionToken: 'child-session-json-token'
        })
      });
      const subaccount = ((await added.json()) as ApiResult<SubaccountView>).data!;

      const synced = await app.request(`/api/subaccounts/${subaccount.id}/team-links/sync`, {
        method: 'POST',
        headers: authHeaders
      });
      const body = await synced.text();
      const syncedJson = JSON.parse(body) as ApiResult<SubaccountView>;
      const stored = subaccountStore.get(subaccount.id);
      const accountsCheckRequests = teamTransport.requests.filter((request) =>
        request.path.startsWith('/backend-api/accounts/check/')
      );
      const sessionRequest = teamTransport.requests.find((request) => request.path.startsWith('/api/auth/session'));

      assert.equal(synced.status, 200, body);
      assert.equal(syncedJson.data!.teamLinks.find((link) => link.accountId === mother.id)?.status, 'member');
      assert.equal(syncedJson.data!.teamLinks.find((link) => link.accountId === mother.id)?.seat, 'usage_based');
      assert.equal(accountsCheckRequests.length, 2);
      assert.equal(accountsCheckRequests[0]!.headers.Authorization, 'Bearer stale-child-web-access-token');
      assert.equal(accountsCheckRequests[1]!.headers.Authorization, `Bearer ${refreshedToken}`);
      assert.match(sessionRequest?.headers.cookie ?? '', /_account=child-chatgpt-account-id/);
      assert.match(sessionRequest?.headers.cookie ?? '', /__Secure-next-auth\.session-token=child-session-json-token/);
      assert.equal(stored?.webAccessToken, refreshedToken);
      assert.equal(store.get(mother.id)?.accessToken, 'mother-access-token');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('preserves cached Team link seats while refreshing only the child workspace list', async () => {
    const { app, dir, store, subaccountStore, authHeaders, mother, teamTransport } = await buildTestApp();
    try {
      const linkedMother = await store.add({
        accountId: 'workspace-account-b',
        email: 'owner-b@example.com',
        accessToken: 'mother-b-access-token'
      });
      teamTransport.accountsCheckByAccessToken.set('child-web-access-token', {
        'workspace-account-id': {
          account: {
            account_id: 'workspace-account-id',
            account_user_role: 'standard-user',
            name: 'Team A',
            plan_type: 'team'
          }
        },
        'workspace-account-b': {
          account: {
            account_id: 'workspace-account-b',
            account_user_role: 'standard-user',
            name: 'Team B',
            plan_type: 'team'
          }
        }
      });
      const added = await app.request('/api/subaccounts/session', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          user: { email: 'child@example.com' },
          account: { id: 'child-chatgpt-account-id' },
          accessToken: 'child-web-access-token'
        })
      });
      const subaccount = ((await added.json()) as ApiResult<SubaccountView>).data!;
      await subaccountStore.saveTeamLink(subaccount.id, {
        accountId: mother.id,
        workspaceId: 'workspace-account-id',
        seat: 'default',
        status: 'member'
      });
      await subaccountStore.saveTeamLink(subaccount.id, {
        accountId: linkedMother.id,
        workspaceId: 'workspace-account-b',
        seat: 'default',
        status: 'member'
      });

      const synced = await app.request(`/api/subaccounts/${subaccount.id}/team-links/sync`, {
        method: 'POST',
        headers: authHeaders
      });
      const syncedJson = (await synced.json()) as ApiResult<SubaccountView>;
      const links = new Map(syncedJson.data!.teamLinks.map((link) => [link.accountId, link]));

      assert.equal(synced.status, 200);
      assert.equal(links.get(mother.id)!.status, 'member');
      assert.equal(links.get(mother.id)!.seat, 'default');
      assert.equal(links.get(linkedMother.id)!.status, 'member');
      assert.equal(links.get(linkedMother.id)!.seat, 'default');
      const userRequests = teamTransport.requests.filter((request) => request.path.includes('/users?'));
      assert.equal(userRequests.length, 0);
      assert.equal(teamTransport.requests.length, 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('removes an existing child Team link when sync no longer finds it', async () => {
    const { app, dir, authHeaders, mother } = await buildTestApp();
    try {
      const added = await app.request('/api/subaccounts/session', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          user: { email: 'child@example.com' },
          account: { id: 'child-chatgpt-account-id' },
          accessToken: 'child-web-access-token'
        })
      });
      const subaccount = ((await added.json()) as ApiResult<SubaccountView>).data!;

      await app.request(`/api/subaccounts/${subaccount.id}/team-invites`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ accountId: mother.id, seat: 'usage_based' })
      });

      const synced = await app.request(`/api/subaccounts/${subaccount.id}/team-links/sync`, {
        method: 'POST',
        headers: authHeaders
      });
      const syncedJson = (await synced.json()) as ApiResult<SubaccountView>;

      assert.equal(synced.status, 200);
      assert.equal(syncedJson.data!.teamLinks.length, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
