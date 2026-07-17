import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type {
  ApiResult,
  CodexAuthRuntimeStatus,
  CodexCredentialJson,
  SubaccountRegistrationJobView,
  SubaccountView
} from '@team-manager/shared';
import { AccountStore } from './accountStore.js';
import { buildApp } from './app.js';
import type { AppConfig } from './config.js';
import { CODEX_AUTH_REDIRECT_URI } from './codexAuth.js';
import { CodexAutoAuthError, type CodexAutoAuthExecutor } from './codexAutoAuth.js';
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

class FakeCodexAutoAuth implements CodexAutoAuthExecutor {
  requests: Array<{
    email: string;
    authUrl: string;
    state: string;
    codeVerifier: string;
    targetChatgptAccountId?: string;
    password?: string;
  }> = [];

  async complete(options: Parameters<CodexAutoAuthExecutor['complete']>[0]) {
    const accountId = options.targetChatgptAccountId ?? 'auto-child-chatgpt-account-id';
    this.requests.push({
      email: options.email,
      authUrl: options.session.authUrl,
      state: options.session.state,
      codeVerifier: options.session.codeVerifier,
      targetChatgptAccountId: options.targetChatgptAccountId,
      password: options.password
    });
    return {
      callbackUrl: `${CODEX_AUTH_REDIRECT_URI}?code=auto-code&state=${options.session.state}`,
      events: [{ phase: 'passwordless_send_otp', status: 200 }, { phase: 'oauth_token_exchange', status: 200 }],
      credential: {
        access_token: 'auto-codex-access-token',
        refresh_token: 'auto-codex-refresh-token',
        id_token: unsignedJwt({
          email: options.email,
          'https://api.openai.com/auth': {
            chatgpt_account_id: accountId,
            chatgpt_plan_type: 'team'
          }
        }),
        account_id: accountId,
        email: options.email,
        type: 'codex' as const,
        last_refresh: '2026-06-18T00:00:00.000Z',
        expired: '2026-06-18T01:00:00.000Z',
        plan_type: 'team'
      }
    };
  }
}

class FakeStreamingCodexAutoAuth extends FakeCodexAutoAuth {
  async complete(options: Parameters<CodexAutoAuthExecutor['complete']>[0]) {
    const result = await super.complete(options);
    for (const event of result.events) {
      await options.onEvent?.(event);
    }
    return result;
  }
}

class FakeAccountLockedAutoAuth implements CodexAutoAuthExecutor {
  async complete() {
    throw new CodexAutoAuthError(
      'Account is locked or unavailable',
      'account_locked',
      'account_locked',
      [{ phase: 'account_locked', status: 200 }]
    );
  }
}

class FakeSubaccountRegistration {
  requests: Array<{ mailGroup?: string }> = [];
  completedMailboxes: string[] = [];

  async register(options: { mailGroup?: string; onEvent?: (event: Record<string, unknown>) => void | Promise<void> }) {
    this.requests.push({ mailGroup: options.mailGroup });
    await options.onEvent?.({ phase: 'registration_identity_allocated', email: 'registered-child@example.com' });
    await options.onEvent?.({ phase: 'chatgpt_auth_session' });
    return {
      email: 'registered-child@example.com',
      password: 'generated-child-password',
      name: 'Alex Miller',
      birthdate: '1996-05-12',
      callbackUrl: 'https://chatgpt.com/',
      session: {
        user: { email: 'registered-child@example.com' },
        account: { id: 'registered-child-chatgpt-account-id' },
        accessToken: chatGptWebAccessToken('registered-child-chatgpt-account-id', 'free'),
        sessionToken: 'registered-child-session-token'
      },
      events: [
        { phase: 'gongxi_get_email', status: 200 },
        { phase: 'user_register', status: 200 },
        { phase: 'chatgpt_auth_session', status: 200 }
      ]
    };
  }

  async completeMailbox(email: string) {
    this.completedMailboxes.push(email);
    return {
      email,
      group: '48team子号',
      events: [{ phase: 'gongxi_move_email_group', status: 200 }]
    };
  }
}

class FakeVerificationRequiredRegistration {
  async register() {
    const { SubaccountRegistrationError } = await import('./subaccountRegistration.js');
    throw new SubaccountRegistrationError(
      'user_register_failed_400: account_creation_failed',
      'verification_required',
      'registration_sentinel',
      'pending-child@example.com',
      'generated-child-password',
      [{ phase: 'user_register', status: 400 }]
    );
  }
}

class FakeRetryableRegistration {
  requests: Array<{ email?: string; password?: string; resumeExisting?: boolean }> = [];
  completedMailboxes: string[] = [];

  async register(options: {
    email?: string;
    password?: string;
    resumeExisting?: boolean;
    onEvent?: (event: Record<string, unknown>) => void | Promise<void>;
  }) {
    this.requests.push({
      email: options.email,
      password: options.password,
      resumeExisting: options.resumeExisting
    });
    if (this.requests.length === 1) {
      const { SubaccountRegistrationError } = await import('./subaccountRegistration.js');
      throw new SubaccountRegistrationError(
        'chatgpt_auth_signin_failed_200: {"url":"https://chatgpt.com/api/auth/signin?csrf=true"}',
        'error',
        'registration_failed',
        'retry-child@example.com',
        'retry-child-password',
        [{ phase: 'chatgpt_auth_signin', status: 200 }]
      );
    }
    await options.onEvent?.({ phase: 'registration_retry_existing_account', email: options.email });
    await options.onEvent?.({ phase: 'chatgpt_auth_session', email: options.email });
    return {
      email: options.email!,
      password: options.password!,
      name: 'Retry Child',
      birthdate: '1996-05-12',
      callbackUrl: 'https://chatgpt.com/',
      session: {
        user: { email: options.email! },
        account: { id: 'retry-child-chatgpt-account-id' },
        accessToken: chatGptWebAccessToken('retry-child-chatgpt-account-id', 'free'),
        sessionToken: 'retry-child-session-token'
      },
      events: [{ phase: 'registration_retry_existing_account', status: 200 }]
    };
  }

  async completeMailbox(email: string) {
    this.completedMailboxes.push(email);
    return { email, group: '48team子号', events: [{ phase: 'gongxi_move_email_group', status: 200 }] };
  }
}

class FakeAccountLockedRegistration {
  async register() {
    const { SubaccountRegistrationError } = await import('./subaccountRegistration.js');
    throw new SubaccountRegistrationError(
      'user_register_failed_403: account disabled',
      'account_locked',
      'account_locked',
      'locked-child@example.com',
      'generated-child-password',
      [{ phase: 'user_register', status: 403 }]
    );
  }
}

class FakeRegistrationEmailUnavailable {
  async register() {
    const { SubaccountRegistrationError } = await import('./subaccountRegistration.js');
    throw new SubaccountRegistrationError(
      'No usable GongXi-Mail email after 10 attempt(s)',
      'error',
      'registration_email_unavailable',
      undefined,
      undefined,
      [
        { phase: 'registration_email_rejected', status: 200 },
        { phase: 'registration_email_rejected', status: 200 }
      ]
    );
  }
}

async function buildTestApp(options: { codexAutoAuth?: CodexAutoAuthExecutor; registration?: unknown } = {}) {
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
  const fakeFetch = async () =>
    ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          access_token: 'codex-access-token',
          refresh_token: 'codex-refresh-token',
          id_token: unsignedJwt({
            email: 'child@example.com',
            'https://api.openai.com/auth': {
              chatgpt_account_id: 'child-chatgpt-account-id',
              chatgpt_plan_type: 'team'
            }
          }),
          expires_in: 3600
        })
    }) as Response;
  const quotaTransport = new RecordingQuotaTransport();
  const teamTransport = new RecordingTeamTransport();
  const app = await buildApp({
    config,
    store,
    subaccountStore,
    subaccountCodexFetch: fakeFetch as typeof fetch,
    subaccountQuotaTransport: quotaTransport,
    subaccountCodexAutoAuth: options.codexAutoAuth,
    subaccountRegistration: options.registration,
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
      const subaccountsResponse = await app.request('/api/subaccounts', { headers: authHeaders });
      const subaccounts = ((await subaccountsResponse.json()) as ApiResult<SubaccountView[]>).data ?? [];
      return { job, subaccount: job.subaccountId ? subaccounts.find((item) => item.id === job.subaccountId) : undefined };
    }
    if (Date.now() >= deadline) throw new Error(`等待自动注册任务超时: ${jobId}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('Subaccount API', () => {
  it('reports missing Codex auto auth runtime config without using fallbacks', async () => {
    const originalWorkerUrl = process.env.TEAMMGR_CURL_CFFI_URL;
    delete process.env.TEAMMGR_CURL_CFFI_URL;
    const { app, dir, authHeaders } = await buildTestApp();
    try {
      const response = await app.request('/api/subaccounts/codex-auth/status', { headers: authHeaders });
      const json = (await response.json()) as ApiResult<CodexAuthRuntimeStatus>;

      assert.equal(response.status, 200);
      assert.equal(json.data!.workerConfigured, false);
      assert.equal(json.data!.workerReachable, false);
      assert.equal(json.data!.codexAutoAuth, false);
      assert.equal(json.data!.subaccountRegistration, false);
      assert.match(json.data!.error ?? '', /TEAMMGR_CURL_CFFI_URL/);
    } finally {
      if (originalWorkerUrl === undefined) delete process.env.TEAMMGR_CURL_CFFI_URL;
      else process.env.TEAMMGR_CURL_CFFI_URL = originalWorkerUrl;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reports available and exhausted phone pool counts from the worker health check', async () => {
    const originalWorkerUrl = process.env.TEAMMGR_CURL_CFFI_URL;
    const originalFetch = globalThis.fetch;
    process.env.TEAMMGR_CURL_CFFI_URL = 'https://worker.example.invalid';
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          ok: true,
          capabilities: {
            codexAutoAuth: true,
            subaccountRegistration: true,
            flaresolverr: true,
            gongxiMail: true,
            phoneOtp: true
          },
          phonePoolCount: 3,
          phonePoolExhaustedCount: 2
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )) as typeof fetch;

    const { app, dir, authHeaders } = await buildTestApp();
    try {
      const response = await app.request('/api/subaccounts/codex-auth/status', { headers: authHeaders });
      const json = (await response.json()) as ApiResult<CodexAuthRuntimeStatus & { phonePoolExhaustedCount?: number }>;

      assert.equal(response.status, 200);
      assert.equal(json.data!.phoneOtp, true);
      assert.equal(json.data!.subaccountRegistration, true);
      assert.equal(json.data!.phonePoolCount, 3);
      assert.equal(json.data!.phonePoolExhaustedCount, 2);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalWorkerUrl === undefined) delete process.env.TEAMMGR_CURL_CFFI_URL;
      else process.env.TEAMMGR_CURL_CFFI_URL = originalWorkerUrl;
      await rm(dir, { recursive: true, force: true });
    }
  });

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
      const listedJson = (await listed.json()) as ApiResult<SubaccountView[]>;
      assert.equal(listedJson.data!.length, 1);
      assert.equal(listedJson.data![0]!.status, 'session_ready');
      assert.equal(listedJson.data![0]!.session?.accessToken, 'child-web-access-token');
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

  it('persists a valid Session Cookie and an invalid Web AT as separate child sync results', async () => {
    const { app, dir, authHeaders, teamTransport } = await buildTestApp();
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

      const refreshed = await app.request(`/api/subaccounts/${subaccount.id}/refresh`, {
        method: 'POST',
        headers: authHeaders
      });
      const body = await refreshed.text();
      const json = JSON.parse(body) as ApiResult<SubaccountView>;

      assert.equal(refreshed.status, 200, body);
      assert.equal(json.data!.sessionTokenStatus, 'valid');
      assert.equal(json.data!.webAccessTokenStatus, 'invalid');
      assert.match(json.data!.lastError ?? '', /token_invalidated/);
      assert.equal(typeof json.data!.lastRefreshAt, 'number');

      const listed = await app.request('/api/subaccounts', { headers: authHeaders });
      const listedJson = (await listed.json()) as ApiResult<SubaccountView[]>;
      assert.equal(listedJson.data![0]!.sessionTokenStatus, 'valid');
      assert.equal(listedJson.data![0]!.webAccessTokenStatus, 'invalid');
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
      teamTransport.membersByWorkspaceId.set('workspace-account-id', [
        {
          id: 'member-child',
          email: 'child@example.com',
          name: 'Child',
          role: 'standard-user',
          seat_type: 'usage_based',
          status: 'active'
        }
      ]);
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
        body: JSON.stringify({ proxy: '  socks5://child-proxy.example:1080  ' })
      });
      const updatedJson = (await updated.json()) as ApiResult<SubaccountView>;
      const view = updatedJson.data as unknown as Record<string, any>;

      assert.equal(updated.status, 200);
      assert.equal(view.proxy, 'socks5://child-proxy.example:1080');
      assert.deepEqual(view.session, {
        user: { email: 'child@example.com' },
        account: { id: 'child-chatgpt-account-id' },
        accessToken: 'child-web-access-token',
        sessionToken: 'child-session-json-token'
      });
      assert.equal((subaccountStore.get(subaccount.id) as any)?.proxy, 'socks5://child-proxy.example:1080');

      const synced = await app.request(`/api/subaccounts/${subaccount.id}/team-links/sync`, {
        method: 'POST',
        headers: authHeaders
      });
      const syncedJson = (await synced.json()) as ApiResult<SubaccountView>;

      assert.equal(synced.status, 200);
      assert.equal(syncedJson.data!.teamLinks.find((link) => link.accountId === mother.id)?.status, 'member');
      assert.equal(teamTransport.requests.length, 2);
      assert.deepEqual(
        teamTransport.requests.map((request) => (request as any).proxy),
        ['socks5://child-proxy.example:1080', 'socks5://child-proxy.example:1080']
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
          { name: 'legacy-token-0', value: 'session-token-0' },
          { name: 'legacy-token-1', value: 'session-token-1' }
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

  it('imports an existing Codex credential JSON as a credential-only child', async () => {
    const { app, dir, authHeaders } = await buildTestApp();
    try {
      const added = await app.request('/api/subaccounts/codex-credential', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          id_token: unsignedJwt({
            email: 'child@example.com',
            'https://api.openai.com/auth': {
              chatgpt_account_id: 'workspace-account-id',
              chatgpt_plan_type: 'team'
            }
          }),
          access_token: 'imported-access-token',
          refresh_token: 'imported-refresh-token',
          account_id: 'workspace-account-id',
          last_refresh: '2026-06-18T00:00:00.000Z',
          email: 'child@example.com',
          type: 'codex',
          expired: '2026-06-18T01:00:00.000Z',
          plan_type: 'team'
        })
      });
      const addedJson = (await added.json()) as ApiResult<SubaccountView>;

      assert.equal(added.status, 200);
      assert.equal(addedJson.data!.email, 'child@example.com');
      assert.equal(addedJson.data!.hasWebSession, false);
      assert.equal(addedJson.data!.status, 'codex_ready');
      assert.equal(addedJson.data!.codexCredentials[0]!.accountId, 'workspace-account-id');
      assert.equal(JSON.stringify(addedJson).includes('imported-refresh-token'), false);
      assert.equal(JSON.stringify(addedJson).includes('imported-access-token'), false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('imports a Codex personal access token credential without OAuth refresh or id tokens', async () => {
    const { app, dir, authHeaders } = await buildTestApp();
    try {
      const added = await app.request('/api/subaccounts/codex-credential', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          personal_access_token: 'at-imported-codex-token',
          account_id: 'workspace-account-id',
          last_refresh: '2026-06-18T00:00:00.000Z',
          email: 'child@example.com',
          type: 'codex',
          expired: '2026-07-18T00:00:00.000Z',
          auth_mode: 'personalAccessToken',
          credential_source: 'personal_access_token',
          credential_id: 'token-imported'
        })
      });
      const body = await added.text();
      const addedJson = JSON.parse(body) as ApiResult<SubaccountView>;

      assert.equal(added.status, 200, body);
      assert.equal(addedJson.data!.email, 'child@example.com');
      assert.equal(addedJson.data!.status, 'codex_ready');
      assert.equal(addedJson.data!.codexCredentials[0]!.accountId, 'workspace-account-id');
      assert.equal(body.includes('at-imported-codex-token'), false);

      const exported = await app.request(
        `/api/subaccounts/${addedJson.data!.id}/codex-credential?chatgptAccountId=workspace-account-id`,
        { headers: authHeaders }
      );
      const exportedJson = (await exported.json()) as ApiResult<CodexCredentialJson>;
      assert.equal(exported.status, 200);
      assert.equal(exportedJson.data!.access_token, 'at-imported-codex-token');
      assert.equal(exportedJson.data!.personal_access_token, 'at-imported-codex-token');
      assert.equal(exportedJson.data!.auth_mode, 'personalAccessToken');
      assert.equal(exportedJson.data!.credential_source, 'personal_access_token');
      assert.equal('refresh_token' in exportedJson.data!, false);
      assert.equal('id_token' in exportedJson.data!, false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('imports Codex credentials with a custom file name and CPA pool group', async () => {
    const { app, dir, authHeaders } = await buildTestApp();
    try {
      const added = await app.request('/api/subaccounts/codex-credential', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          fileName: 'cpa-a-child.json',
          groupName: 'CPA-A',
          credential: {
            id_token: unsignedJwt({
              email: 'child@example.com',
              'https://api.openai.com/auth': {
                chatgpt_account_id: 'workspace-account-id',
                chatgpt_plan_type: 'team'
              }
            }),
            access_token: 'imported-access-token',
            refresh_token: 'imported-refresh-token',
            account_id: 'workspace-account-id',
            last_refresh: '2026-06-18T00:00:00.000Z',
            email: 'child@example.com',
            type: 'codex',
            expired: '2026-06-18T01:00:00.000Z',
            plan_type: 'team'
          }
        })
      });
      const body = await added.text();
      const addedJson = JSON.parse(body) as ApiResult<SubaccountView>;

      assert.equal(added.status, 200, body);
      assert.equal(addedJson.data!.codexCredentials[0]!.fileName, 'cpa-a-child.json');
      assert.equal(addedJson.data!.codexCredentials[0]!.groupName, 'CPA-A');
      assert.equal(body.includes('imported-refresh-token'), false);
      assert.equal(body.includes('imported-access-token'), false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('deletes the selected Team workspace Codex credential without removing the child account', async () => {
    const { app, dir, authHeaders } = await buildTestApp();
    try {
      const added = await app.request('/api/subaccounts/codex-credential', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          fileName: 'cpa-a-child.json',
          groupName: 'CPA-A',
          credential: {
            id_token: unsignedJwt({
              email: 'child@example.com',
              'https://api.openai.com/auth': {
                chatgpt_account_id: 'workspace-account-id',
                chatgpt_plan_type: 'team'
              }
            }),
            access_token: 'imported-access-token',
            refresh_token: 'imported-refresh-token',
            account_id: 'workspace-account-id',
            last_refresh: '2026-06-18T00:00:00.000Z',
            email: 'child@example.com',
            type: 'codex',
            expired: '2026-06-18T01:00:00.000Z',
            plan_type: 'team'
          }
        })
      });
      const subaccount = ((await added.json()) as ApiResult<SubaccountView>).data!;
      const credential = subaccount.codexCredentials[0]!;
      const credentialPath = join(dir, 'subaccount-credentials', subaccount.id, credential.fileName);
      assert.equal(existsSync(credentialPath), true);

      const removed = await app.request(
        `/api/subaccounts/${subaccount.id}/codex-credential?chatgptAccountId=workspace-account-id`,
        {
          method: 'DELETE',
          headers: authHeaders
        }
      );
      const removedBody = await removed.text();

      assert.equal(removed.status, 200, removedBody);
      const removedJson = JSON.parse(removedBody) as ApiResult<SubaccountView>;
      assert.equal(removedJson.data!.id, subaccount.id);
      assert.equal(removedJson.data!.email, 'child@example.com');
      assert.equal(removedJson.data!.status, 'empty');
      assert.equal(removedJson.data!.codexCredentials.length, 0);
      assert.equal(existsSync(credentialPath), false);

      const missing = await app.request(
        `/api/subaccounts/${subaccount.id}/codex-credential?chatgptAccountId=workspace-account-id`,
        { headers: authHeaders }
      );
      assert.equal(missing.status, 404);

      const logs = await app.request(`/api/subaccounts/${subaccount.id}/logs`, { headers: authHeaders });
      const logsJson = (await logs.json()) as ApiResult<
        Array<{ phase: string; status: string; data?: { accountId?: string; fileName?: string } }>
      >;
      const deleteLog = logsJson.data!.find((log) => log.phase === 'codex_credential_delete');
      assert.equal(deleteLog?.status, 'empty');
      assert.equal(deleteLog?.data?.accountId, 'workspace-account-id');
      assert.equal(deleteLog?.data?.fileName, 'cpa-a-child.json');
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
      await subaccountStore.saveCodexCredential(subaccount.id, {
        access_token: 'codex-access-token',
        refresh_token: 'codex-refresh-token',
        id_token: 'codex-id-token',
        account_id: 'workspace-account-id',
        email: 'child@example.com',
        type: 'codex',
        last_refresh: '2026-06-18T00:00:00.000Z',
        expired: '2026-06-18T01:00:00.000Z',
        plan_type: 'team'
      });
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
            { name: 'legacy-token-0', value: 'session-token-0' },
            { name: 'legacy-token-1', value: 'session-token-1' }
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

  it('starts Codex Auth and completes a pasted callback into credential JSON', async () => {
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

      const started = await app.request(`/api/subaccounts/${subaccount.id}/codex-auth/start`, {
        method: 'POST',
        headers: authHeaders
      });
      const startedJson = (await started.json()) as ApiResult<{ sessionId: string; authUrl: string }>;
      const authUrl = new URL(startedJson.data!.authUrl);
      const state = authUrl.searchParams.get('state');
      assert.ok(state);
      assert.equal(authUrl.searchParams.get('prompt'), 'login');

      const completed = await app.request(`/api/subaccounts/${subaccount.id}/codex-auth/callback`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          sessionId: startedJson.data!.sessionId,
          callbackUrl: `${CODEX_AUTH_REDIRECT_URI}?code=auth-code&state=${state}`
        })
      });
      const completedJson = (await completed.json()) as ApiResult<SubaccountView>;
      assert.equal(completedJson.data!.status, 'codex_ready');
      assert.equal(completedJson.data!.codexCredentials.length, 1);

      const credential = await app.request(`/api/subaccounts/${subaccount.id}/codex-credential`, {
        headers: authHeaders
      });
      const credentialJson = (await credential.json()) as ApiResult<Record<string, unknown>>;
      assert.equal(credentialJson.data!.type, 'codex');
      assert.equal(credentialJson.data!.email, 'child@example.com');
      assert.equal(credentialJson.data!.refresh_token, 'codex-refresh-token');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('auto-completes Codex Auth through the worker executor', async () => {
    const codexAutoAuth = new FakeCodexAutoAuth();
    const { app, dir, authHeaders } = await buildTestApp({ codexAutoAuth });
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

      const completed = await app.request(`/api/subaccounts/${subaccount.id}/codex-auth/auto`, {
        method: 'POST',
        headers: authHeaders
      });
      const completedJson = (await completed.json()) as ApiResult<SubaccountView>;

      assert.equal(completed.status, 200);
      assert.equal(completedJson.data!.status, 'codex_ready');
      assert.equal(completedJson.data!.codexCredentials.length, 1);
      assert.equal(codexAutoAuth.requests.length, 1);
      assert.equal(codexAutoAuth.requests[0]!.email, 'child@example.com');
      assert.match(new URL(codexAutoAuth.requests[0]!.authUrl).searchParams.get('login_hint') ?? '', /child@example.com/);

      const credential = await app.request(`/api/subaccounts/${subaccount.id}/codex-credential`, {
        headers: authHeaders
      });
      const credentialJson = (await credential.json()) as ApiResult<Record<string, unknown>>;
      assert.equal(credentialJson.data!.refresh_token, 'auto-codex-refresh-token');

      const logs = await app.request(`/api/subaccounts/${subaccount.id}/logs`, { headers: authHeaders });
      const logsJson = (await logs.json()) as ApiResult<
        Array<{ phase: string; status: string; data?: { httpStatus?: number } }>
      >;
      assert.ok(logsJson.data!.some((log) => log.phase === 'codex_auto_auth_complete'));
      assert.ok(
        logsJson.data!.some(
          (log) => log.phase === 'passwordless_send_otp' && log.status === 'ok' && log.data?.httpStatus === 200
        )
      );
      assert.ok(logsJson.data!.some((log) => log.phase === 'oauth_token_exchange' && log.status === 'ok'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('does not duplicate Codex auto auth event logs when the worker streams progress before the final result', async () => {
    const { app, dir, authHeaders } = await buildTestApp({ codexAutoAuth: new FakeStreamingCodexAutoAuth() });
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

      const completed = await app.request(`/api/subaccounts/${subaccount.id}/codex-auth/auto`, {
        method: 'POST',
        headers: authHeaders
      });
      assert.equal(completed.status, 200);

      const logs = await app.request(`/api/subaccounts/${subaccount.id}/logs`, { headers: authHeaders });
      const logsJson = (await logs.json()) as ApiResult<Array<{ phase: string }>>;
      assert.equal(logsJson.data!.filter((log) => log.phase === 'passwordless_send_otp').length, 1);
      assert.equal(logsJson.data!.filter((log) => log.phase === 'oauth_token_exchange').length, 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('stores Codex credentials for the selected Team workspace', async () => {
    const codexAutoAuth = new FakeCodexAutoAuth();
    const { app, dir, authHeaders } = await buildTestApp({ codexAutoAuth });
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

      const completed = await app.request(`/api/subaccounts/${subaccount.id}/codex-auth/auto`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ chatgptAccountId: 'workspace-account-id' })
      });
      const completedJson = (await completed.json()) as ApiResult<SubaccountView>;

      assert.equal(completed.status, 200);
      assert.equal(codexAutoAuth.requests[0]!.targetChatgptAccountId, 'workspace-account-id');
      assert.equal(completedJson.data!.codexCredentials[0]!.accountId, 'workspace-account-id');

      const credential = await app.request(
        `/api/subaccounts/${subaccount.id}/codex-credential?chatgptAccountId=workspace-account-id`,
        { headers: authHeaders }
      );
      const credentialJson = (await credential.json()) as ApiResult<Record<string, unknown>>;
      assert.equal(credentialJson.data!.account_id, 'workspace-account-id');
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

      const created = await app.request(`/api/subaccounts/${subaccount.id}/codex-auth/personal-access-token`, {
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
        `/api/subaccounts/${subaccount.id}/codex-credential?chatgptAccountId=workspace-account-id`,
        { headers: authHeaders }
      );
      const exportedJson = (await exported.json()) as ApiResult<Record<string, unknown>>;
      assert.equal(exportedJson.data!.access_token, 'at-generated-codex-token');
      assert.equal(exportedJson.data!.personal_access_token, 'at-generated-codex-token');
      assert.equal(exportedJson.data!.account_id, 'workspace-account-id');
      assert.equal(exportedJson.data!.email, 'child@example.com');
      assert.equal(exportedJson.data!.type, 'codex');
      assert.equal(exportedJson.data!.auth_mode, 'personalAccessToken');
      assert.equal('refresh_token' in exportedJson.data!, false);
      assert.equal('id_token' in exportedJson.data!, false);
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

      const created = await app.request(`/api/subaccounts/${subaccount.id}/codex-auth/personal-access-token`, {
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

  it('downloads the full workspace-scoped ChatGPT session JSON from the child session token', async () => {
    const { app, dir, authHeaders, teamTransport } = await buildTestApp();
    try {
      const workspaceWebAccessToken = chatGptWebAccessToken('workspace-account-id');
      teamTransport.sessionAccessTokensByWorkspaceId.set('workspace-account-id', workspaceWebAccessToken);
      const added = await app.request('/api/subaccounts/session', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          proxy: '  socks5://child-proxy.example:1080  ',
          session: {
            user: { email: 'child@example.com' },
            account: { id: 'personal-account-id' },
            accessToken: chatGptWebAccessToken('personal-account-id', 'free'),
            sessionToken: 'child-session-json-token'
          }
        })
      });
      const subaccount = ((await added.json()) as ApiResult<SubaccountView>).data!;

      const downloaded = await app.request(
        `/api/subaccounts/${subaccount.id}/workspace-session?chatgptAccountId=workspace-account-id`,
        { headers: authHeaders }
      );
      const body = await downloaded.text();
      const downloadedJson = JSON.parse(body) as ApiResult<Record<string, unknown>>;

      assert.equal(downloaded.status, 200, body);
      assert.deepEqual(downloadedJson.data, {
        user: { email: 'child@example.com' },
        account: { id: 'workspace-account-id' },
        accessToken: workspaceWebAccessToken
      });

      const sessionRequest = teamTransport.requests.find(
        (item) =>
          item.path.startsWith('/api/auth/session') &&
          item.path.includes('team_manager_workspace=workspace-account-id')
      );
      assert.equal(sessionRequest?.method, 'GET');
      assert.match(
        sessionRequest?.headers.cookie ?? '',
        /__Secure-next-auth\.session-token=child-session-json-token/
      );
      assert.match(sessionRequest?.headers.cookie ?? '', /_account=workspace-account-id/);
      assert.equal((sessionRequest as any)?.proxy, 'socks5://child-proxy.example:1080');
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

      const created = await app.request(`/api/subaccounts/${subaccount.id}/codex-auth/personal-access-token`, {
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

  it('creates a K12 Codex credential from the child workspace session instead of a personal access token', async () => {
    const { app, dir, authHeaders, teamTransport, subaccountStore } = await buildTestApp();
    try {
      const k12Token = chatGptWebAccessToken('k12-workspace-id', 'k12');
      teamTransport.sessionAccessTokensByWorkspaceId.set('k12-workspace-id', k12Token);
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
      const subaccount = ((await added.json()) as ApiResult<SubaccountView>).data!;
      await subaccountStore.saveTeamLink(subaccount.id, {
        accountId: 'k12-workspace-id',
        workspaceId: 'k12-workspace-id',
        workspaceName: 'K12 Space',
        planType: 'k12',
        seat: 'default',
        status: 'member'
      });

      const created = await app.request(`/api/subaccounts/${subaccount.id}/codex-auth/k12-credential`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ chatgptAccountId: 'k12-workspace-id' })
      });
      const body = await created.text();
      const createdJson = JSON.parse(body) as ApiResult<SubaccountView>;

      assert.equal(created.status, 200, body);
      assert.equal(createdJson.data!.codexCredentials[0]!.accountId, 'k12-workspace-id');
      assert.equal(createdJson.data!.codexCredentials[0]!.planType, 'k12');
      assert.equal(
        teamTransport.requests.some((request) => request.path === '/backend-api/wham/auth-credentials'),
        false
      );
      const sessionRequest = teamTransport.requests.find(
        (request) =>
          request.method === 'GET' &&
          request.path.startsWith('/api/auth/session') &&
          request.path.includes('exchange_workspace_token=true') &&
          request.path.includes('workspace_id=k12-workspace-id')
      );
      assert.equal(sessionRequest?.method, 'GET');

      const exported = await app.request(
        `/api/subaccounts/${subaccount.id}/codex-credential?chatgptAccountId=k12-workspace-id`,
        { headers: authHeaders }
      );
      const exportedJson = (await exported.json()) as ApiResult<CodexCredentialJson>;
      assert.equal(exported.status, 200);
      assert.equal(exportedJson.data!.access_token, k12Token);
      assert.equal(exportedJson.data!.account_id, 'k12-workspace-id');
      assert.equal(exportedJson.data!.email, 'child@example.com');
      assert.equal(exportedJson.data!.type, 'codex');
      assert.equal(exportedJson.data!.plan_type, 'k12');
      assert.equal(exportedJson.data!.auth_mode, 'chatgpt');
      assert.equal(exportedJson.data!.credential_source, 'oauth');
      assert.equal(typeof exportedJson.data!.id_token, 'string');
      assert.equal('personal_access_token' in exportedJson.data!, false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('marks a child account as locked when Codex auto auth reports account_locked', async () => {
    const { app, dir, authHeaders, subaccountStore } = await buildTestApp({
      codexAutoAuth: new FakeAccountLockedAutoAuth()
    });
    try {
      const added = await app.request('/api/subaccounts/session', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          user: { email: 'locked-child@example.com' },
          account: { id: 'locked-child-chatgpt-account-id' },
          accessToken: 'locked-child-web-access-token'
        })
      });
      const subaccount = ((await added.json()) as ApiResult<SubaccountView>).data!;

      const completed = await app.request(`/api/subaccounts/${subaccount.id}/codex-auth/auto`, {
        method: 'POST',
        headers: authHeaders
      });
      const completedJson = (await completed.json()) as ApiResult<SubaccountView>;

      assert.equal(completed.status, 502);
      assert.equal(completedJson.error, 'Account is locked or unavailable');
      assert.equal(subaccountStore.get(subaccount.id)?.status, 'account_locked');

      const logs = await app.request(`/api/subaccounts/${subaccount.id}/logs`, { headers: authHeaders });
      const logsJson = (await logs.json()) as ApiResult<Array<{ phase: string; status: string }>>;
      assert.ok(
        logsJson.data!.some((log) => log.phase === 'codex_auto_auth_complete' && log.status === 'account_locked')
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects a pasted Codex callback when the selected workspace does not match the target', async () => {
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

      const started = await app.request(`/api/subaccounts/${subaccount.id}/codex-auth/start`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ chatgptAccountId: 'workspace-account-id' })
      });
      const startedJson = (await started.json()) as ApiResult<{ sessionId: string; authUrl: string }>;
      const state = new URL(startedJson.data!.authUrl).searchParams.get('state')!;

      const completed = await app.request(`/api/subaccounts/${subaccount.id}/codex-auth/callback`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          sessionId: startedJson.data!.sessionId,
          callbackUrl: `${CODEX_AUTH_REDIRECT_URI}?code=auth-code&state=${state}`
        })
      });
      const completedJson = (await completed.json()) as ApiResult;

      assert.equal(completed.status, 409);
      assert.equal(completedJson.ok, false);
      assert.match(completedJson.error ?? '', /workspace 与目标不一致/);
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
      const started = await app.request(`/api/subaccounts/${subaccount.id}/codex-auth/start`, {
        method: 'POST',
        headers: authHeaders
      });
      const startedJson = (await started.json()) as ApiResult<{ sessionId: string; authUrl: string }>;
      const state = new URL(startedJson.data!.authUrl).searchParams.get('state')!;
      await app.request(`/api/subaccounts/${subaccount.id}/codex-auth/callback`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          sessionId: startedJson.data!.sessionId,
          callbackUrl: `${CODEX_AUTH_REDIRECT_URI}?code=auth-code&state=${state}`
        })
      });

      const refreshed = await app.request(`/api/subaccounts/${subaccount.id}/quota/refresh`, {
        method: 'POST',
        headers: authHeaders
      });
      const refreshedJson = (await refreshed.json()) as ApiResult<{
        status: string;
        windows: Array<{ id: string; usedPercent: number }>;
      }>;

      assert.equal(refreshedJson.data!.status, 'success');
      assert.equal(refreshedJson.data!.windows[0]!.id, 'code-five-hour');
      assert.equal(refreshedJson.data!.windows[0]!.usedPercent, 28);
      assert.equal(quotaTransport.requests[0]!.path, '/backend-api/wham/usage');
      assert.equal(quotaTransport.requests[0]!.headers.Authorization, 'Bearer codex-access-token');
      assert.equal(quotaTransport.requests[0]!.headers['Chatgpt-Account-Id'], 'child-chatgpt-account-id');
      assert.equal((quotaTransport.requests[0] as any).proxy, 'http://quota-proxy.example:8080');

      const listed = await app.request('/api/subaccounts', { headers: authHeaders });
      const listedJson = (await listed.json()) as ApiResult<SubaccountView[]>;
      assert.equal(listedJson.data![0]!.codexCredentials[0]!.lastQuota?.windows[0]!.usedPercent, 28);
      assert.equal(typeof listedJson.data![0]!.codexCredentials[0]!.lastQuotaAt, 'number');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('registers a new child Web Session, stores the password, logs the raw trace, and moves the mailbox', async () => {
    const registration = new FakeSubaccountRegistration();
    const { app, dir, authHeaders, subaccountStore } = await buildTestApp({ registration });
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
      assert.equal(registered.session?.sessionToken, 'registered-child-session-token');
      assert.equal(registered.registrationPassword, 'generated-child-password');
      assert.equal(registered.codexCredentials.length, 0);
      assert.equal(registration.requests[0]!.mailGroup, 'clean-outlook');
      assert.deepEqual(registration.completedMailboxes, ['registered-child@example.com']);

      const stored = subaccountStore.get(registered.id) as unknown as { registrationPassword?: string };
      assert.equal(stored.registrationPassword, 'generated-child-password');

      const allLogs = await app.request(`/api/subaccounts/${registered.id}/logs`, { headers: authHeaders });
      const allLogsJson = (await allLogs.json()) as ApiResult<Array<{ phase: string; message: string }>>;
      assert.ok(allLogsJson.data!.some((log) => log.phase === 'subaccount_registration_complete'));
      assert.ok(allLogsJson.data!.some((log) => log.phase === 'subaccount_registration_trace'));
      assert.ok(allLogsJson.data!.some((log) => log.phase === 'subaccount_registration_mailbox_complete'));
      assert.equal(JSON.stringify(allLogsJson).includes('generated-child-password'), true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps a newly allocated registration account visible when sentinel verification is required', async () => {
    const { app, dir, authHeaders, subaccountStore } = await buildTestApp({
      registration: new FakeVerificationRequiredRegistration()
    });
    try {
      const started = await app.request('/api/subaccounts/registration/start', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({})
      });
      assert.equal(started.status, 200);
      const startedJson = (await started.json()) as ApiResult<SubaccountRegistrationJobView>;
      const completed = await waitForRegistrationJob(app, authHeaders, startedJson.data!.id);
      const registered = completed.subaccount!;

      assert.equal(completed.job.status, 'failed');
      assert.equal(registered.email, 'pending-child@example.com');
      assert.equal(registered.status, 'verification_required');
      assert.match(registered.lastError ?? '', /account_creation_failed/);
      assert.equal(registered.registrationPassword, 'generated-child-password');

      const stored = subaccountStore.get(registered.id) as unknown as { registrationPassword?: string };
      assert.equal(stored.registrationPassword, 'generated-child-password');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('retries a failed registration job with the same saved email and password', async () => {
    const registration = new FakeRetryableRegistration();
    const { app, dir, authHeaders } = await buildTestApp({ registration });
    try {
      const started = await app.request('/api/subaccounts/registration/start', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({})
      });
      const startedJson = (await started.json()) as ApiResult<SubaccountRegistrationJobView>;
      const failed = await waitForRegistrationJob(app, authHeaders, startedJson.data!.id);
      assert.equal(failed.job.status, 'failed');
      assert.equal(failed.subaccount?.email, 'retry-child@example.com');
      assert.equal(failed.subaccount?.registrationPassword, 'retry-child-password');

      const retried = await app.request(`/api/subaccounts/registration/jobs/${failed.job.id}/retry`, {
        method: 'POST',
        headers: authHeaders
      });
      const retriedBody = await retried.text();
      const retriedJson = JSON.parse(retriedBody) as ApiResult<SubaccountRegistrationJobView>;
      assert.equal(retried.status, 200, retriedBody);
      assert.equal(retriedJson.data!.id, failed.job.id);
      assert.equal(retriedJson.data!.status, 'queued');

      const completed = await waitForRegistrationJob(app, authHeaders, failed.job.id);
      assert.equal(completed.job.status, 'succeeded');
      assert.equal(completed.subaccount?.email, 'retry-child@example.com');
      assert.equal(completed.subaccount?.session?.sessionToken, 'retry-child-session-token');
      assert.deepEqual(registration.requests, [
        { email: undefined, password: undefined, resumeExisting: false },
        { email: 'retry-child@example.com', password: 'retry-child-password', resumeExisting: false }
      ]);
      assert.deepEqual(registration.completedMailboxes, ['retry-child@example.com']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps a locked registration account visible with account_locked status', async () => {
    const { app, dir, authHeaders, subaccountStore } = await buildTestApp({
      registration: new FakeAccountLockedRegistration()
    });
    try {
      const started = await app.request('/api/subaccounts/registration/start', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({})
      });
      assert.equal(started.status, 200);
      const startedJson = (await started.json()) as ApiResult<SubaccountRegistrationJobView>;
      const completed = await waitForRegistrationJob(app, authHeaders, startedJson.data!.id);
      const registered = completed.subaccount!;

      assert.equal(completed.job.status, 'failed');
      assert.equal(registered.email, 'locked-child@example.com');
      assert.equal(registered.status, 'account_locked');
      assert.match(registered.lastError ?? '', /account disabled/);
      assert.equal(registered.registrationPassword, 'generated-child-password');

      const stored = subaccountStore.get(registered.id) as unknown as { registrationPassword?: string };
      assert.equal(stored.registrationPassword, 'generated-child-password');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps a failed background job without creating a child when registration has no usable email', async () => {
    const { app, dir, authHeaders, subaccountStore } = await buildTestApp({
      registration: new FakeRegistrationEmailUnavailable()
    });
    try {
      const started = await app.request('/api/subaccounts/registration/start', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({})
      });
      const startedJson = (await started.json()) as ApiResult<SubaccountRegistrationJobView>;
      const completed = await waitForRegistrationJob(app, authHeaders, startedJson.data!.id);

      assert.equal(started.status, 200);
      assert.equal(completed.job.status, 'failed');
      assert.match(completed.job.error ?? '', /No usable GongXi-Mail email/);
      assert.equal(completed.subaccount, undefined);
      assert.equal(subaccountStore.list().length, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reuses the registration password for Codex auto auth and keeps it in the private raw logs', async () => {
    const codexAutoAuth = new FakeCodexAutoAuth();
    const { app, dir, authHeaders } = await buildTestApp({
      codexAutoAuth,
      registration: new FakeVerificationRequiredRegistration()
    });
    try {
      const started = await app.request('/api/subaccounts/registration/start', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({})
      });
      assert.equal(started.status, 200);
      const startedJson = (await started.json()) as ApiResult<SubaccountRegistrationJobView>;
      const registrationResult = await waitForRegistrationJob(app, authHeaders, startedJson.data!.id);
      const registered = registrationResult.subaccount!;

      const completed = await app.request(`/api/subaccounts/${registered.id}/codex-auth/auto`, {
        method: 'POST',
        headers: authHeaders
      });
      assert.equal(completed.status, 200);

      assert.equal(codexAutoAuth.requests[0]!.email, 'pending-child@example.com');
      assert.equal(codexAutoAuth.requests[0]!.password, 'generated-child-password');

      const logs = await app.request(`/api/subaccounts/${registered.id}/logs`, { headers: authHeaders });
      const logsText = await logs.text();
      assert.equal(logsText.includes('generated-child-password'), true);
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

  it('lets a child account request joining a K12 workspace without mother credentials or billing confirmation', async () => {
    const { app, dir, store, authHeaders, mother, teamTransport } = await buildTestApp();
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

      const joined = await app.request(`/api/subaccounts/${subaccount.id}/k12-joins`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ workspaceId: 'external-k12-workspace-id' })
      });
      const joinedJson = (await joined.json()) as ApiResult<SubaccountView>;
      const joinRequest = teamTransport.requests.find((request) =>
        request.path === '/backend-api/accounts/external-k12-workspace-id/invites/request'
      );

      assert.equal(joined.status, 200);
      assert.equal(joinRequest?.method, 'POST');
      assert.equal(joinRequest?.headers.Authorization, `Bearer ${childToken}`);
      assert.equal(joinRequest?.body, '{}');
      assert.equal(
        teamTransport.requests.some((request) => request.headers.Authorization === 'Bearer mother-access-token'),
        false
      );
      assert.equal(store.get(mother.id)?.accessToken, 'mother-access-token');
      assert.equal(joinedJson.data!.teamLinks[0]!.accountId, 'external-k12-workspace-id');
      assert.equal(joinedJson.data!.teamLinks[0]!.workspaceId, 'external-k12-workspace-id');
      assert.equal(joinedJson.data!.teamLinks[0]!.planType, 'k12');
      assert.equal(joinedJson.data!.teamLinks[0]!.status, 'unknown');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects Team link sync for credential-only child accounts instead of using mother credentials', async () => {
    const { app, dir, authHeaders, teamTransport } = await buildTestApp();
    try {
      const added = await app.request('/api/subaccounts/codex-credential', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          access_token: 'codex-access-token',
          refresh_token: 'codex-refresh-token',
          id_token: unsignedJwt({
            email: 'child@example.com',
            'https://api.openai.com/auth': {
              chatgpt_account_id: 'workspace-account-id',
              chatgpt_plan_type: 'team'
            }
          }),
          account_id: 'workspace-account-id',
          email: 'child@example.com',
          type: 'codex',
          expired: '2026-06-18T01:00:00.000Z',
          last_refresh: '2026-06-18T00:00:00.000Z'
        })
      });
      const subaccount = ((await added.json()) as ApiResult<SubaccountView>).data!;

      const synced = await app.request(`/api/subaccounts/${subaccount.id}/team-links/sync`, {
        method: 'POST',
        headers: authHeaders
      });
      const syncedJson = (await synced.json()) as ApiResult;

      assert.equal(synced.status, 400);
      assert.match(syncedJson.error ?? '', /缺少 ChatGPT Web session/);
      assert.equal(teamTransport.requests.length, 0);
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
      teamTransport.membersByWorkspaceId.set('workspace-account-id', [
        {
          id: 'member-child',
          email: 'child@example.com',
          name: 'Child',
          role: 'standard-user',
          seat_type: 'usage_based',
          status: 'active'
        }
      ]);
      teamTransport.membersByWorkspaceId.set('workspace-account-b', [
        {
          id: 'member-child',
          email: 'child@example.com',
          name: 'Child',
          role: 'standard-user',
          seat_type: 'default',
          status: 'active'
        }
      ]);

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
          '/backend-api/accounts/check/v4-2023-04-27?timezone_offset_min=-480',
          '/backend-api/accounts/workspace-account-id/users?offset=0&limit=25&query=child%40example.com',
          '/backend-api/accounts/workspace-account-b/users?offset=0&limit=25&query=child%40example.com'
        ]
      );
      assert.equal(teamTransport.requests[0]!.headers.Authorization, 'Bearer child-web-access-token');
      assert.equal(teamTransport.requests[0]!.headers['chatgpt-account-id'], 'child-chatgpt-account-id');
      const userRequests = teamTransport.requests.filter((request) => request.path.includes('/users?'));
      assert.equal(userRequests.length, 2);
      assert.deepEqual(
        userRequests.map((request) => request.headers.Authorization),
        ['Bearer child-web-access-token', 'Bearer child-web-access-token']
      );
      assert.deepEqual(
        userRequests.map((request) => request.headers['chatgpt-account-id']),
        ['workspace-account-id', 'workspace-account-b']
      );
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
            plan_type: 'k12'
          }
        }
      });
      teamTransport.membersByWorkspaceId.set('workspace-account-id', [
        {
          id: 'member-child',
          email: 'child@example.com',
          name: 'Child',
          role: 'standard-user',
          seat_type: 'usage_based',
          status: 'active'
        }
      ]);
      teamTransport.membersByWorkspaceId.set('external-workspace-id', [
        {
          id: 'member-child-external',
          email: 'child@example.com',
          name: 'Child',
          role: 'standard-user',
          seat_type: 'default',
          status: 'active'
        }
      ]);

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
      assert.equal(linksByWorkspaceId.get('external-workspace-id')!.planType, 'k12');
      assert.equal(linksByWorkspaceId.get('external-workspace-id')!.role, 'standard-user');
      assert.equal(linksByWorkspaceId.get('external-workspace-id')!.seat, 'default');
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
      teamTransport.membersByWorkspaceId.set('workspace-account-id', [
        {
          id: 'member-child',
          email: 'child@example.com',
          name: 'Child',
          role: 'standard-user',
          seat_type: 'default',
          status: 'active'
        }
      ]);

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
      assert.equal(syncedJson.data!.teamLinks.find((link) => link.accountId === mother.id)?.seat, 'default');
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

  it('refreshes child-visible Team link seats with the child Web session users query', async () => {
    const { app, dir, store, authHeaders, mother, teamTransport } = await buildTestApp();
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
      teamTransport.membersByWorkspaceId.set('workspace-account-id', [
        {
          id: 'member-child',
          email: 'child@example.com',
          name: 'Child',
          role: 'standard-user',
          seat_type: 'default',
          status: 'active'
        }
      ]);
      teamTransport.membersByWorkspaceId.set('workspace-account-b', [
        {
          id: 'member-child',
          email: 'child@example.com',
          name: 'Child',
          role: 'standard-user',
          seat_type: 'default',
          status: 'active'
        }
      ]);

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
      assert.equal(links.get(mother.id)!.status, 'member');
      assert.equal(links.get(mother.id)!.seat, 'default');
      assert.equal(links.get(linkedMother.id)!.status, 'member');
      assert.equal(links.get(linkedMother.id)!.seat, 'default');
      const userRequests = teamTransport.requests.filter((request) => request.path.includes('/users?'));
      assert.equal(userRequests.length, 2);
      assert.deepEqual(
        userRequests.map((request) => request.headers.Authorization),
        ['Bearer child-web-access-token', 'Bearer child-web-access-token']
      );
      assert.equal(
        userRequests.some((request) => request.headers.Authorization === 'Bearer mother-access-token'),
        false
      );
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
