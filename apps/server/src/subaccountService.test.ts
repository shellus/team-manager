import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ApiResult, CodexAuthRuntimeStatus, SubaccountView } from '@team-manager/shared';
import { AccountStore } from './accountStore.js';
import { buildApp } from './app.js';
import type { AppConfig } from './config.js';
import { CODEX_AUTH_REDIRECT_URI } from './codexAuth.js';
import { CodexAutoAuthError, type CodexAutoAuthExecutor } from './codexAutoAuth.js';
import { SubaccountStore } from './subaccountStore.js';
import type { Transport } from './transport.js';

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function unsignedJwt(payload: Record<string, unknown>): string {
  return `${base64UrlJson({ alg: 'none', typ: 'JWT' })}.${base64UrlJson(payload)}.signature`;
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

  async fetch(req: { method: string; path: string; headers: Record<string, string>; body?: string }) {
    this.requests.push(req);
    if (req.method === 'GET' && req.path.startsWith('/backend-api/accounts/check/')) {
      const token = req.headers.Authorization?.replace(/^Bearer\s+/i, '') ?? '';
      return {
        status: 200,
        body: JSON.stringify({
          accounts: this.accountsCheckByAccessToken.get(token) ?? {},
          account_ordering: Object.keys(this.accountsCheckByAccessToken.get(token) ?? {})
        })
      };
    }
    if (req.method === 'GET' && req.path.includes('/users?')) {
      const workspaceId = req.path.match(/\/backend-api\/accounts\/([^/]+)\/users/)?.[1] ?? '';
      const items = this.membersByWorkspaceId.get(workspaceId) ?? [];
      return { status: 200, body: JSON.stringify({ items, total: items.length }) };
    }
    if (req.method === 'GET' && req.path.includes('/invites?')) {
      const workspaceId = req.path.match(/\/backend-api\/accounts\/([^/]+)\/invites/)?.[1] ?? '';
      const items = this.invitesByWorkspaceId.get(workspaceId) ?? [];
      return { status: 200, body: JSON.stringify({ items, total: items.length }) };
    }
    if (req.method === 'POST' && req.path.includes('/invites')) {
      return { status: 200, body: JSON.stringify({ success: true }) };
    }
    return { status: 404, body: JSON.stringify({ error: 'not found' }) };
  }
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
  requests: Array<{
    authUrl: string;
    state: string;
    codeVerifier: string;
    mailGroup?: string;
    targetChatgptAccountId?: string;
  }> = [];

  async register(options: {
    session: { authUrl: string; state: string; codeVerifier: string };
    mailGroup?: string;
    targetChatgptAccountId?: string;
  }) {
    const accountId = options.targetChatgptAccountId ?? 'registered-child-chatgpt-account-id';
    this.requests.push({
      authUrl: options.session.authUrl,
      state: options.session.state,
      codeVerifier: options.session.codeVerifier,
      mailGroup: options.mailGroup,
      targetChatgptAccountId: options.targetChatgptAccountId
    });
    return {
      email: 'registered-child@example.com',
      password: 'generated-child-password',
      callbackUrl: `${CODEX_AUTH_REDIRECT_URI}?code=registered-code&state=${options.session.state}`,
      events: [
        { phase: 'gongxi_get_email', status: 200 },
        { phase: 'user_register', status: 200 },
        { phase: 'oauth_token_exchange', status: 200 }
      ],
      credential: {
        access_token: 'registered-codex-access-token',
        refresh_token: 'registered-codex-refresh-token',
        id_token: unsignedJwt({
          email: 'registered-child@example.com',
          'https://api.openai.com/auth': {
            chatgpt_account_id: accountId,
            chatgpt_plan_type: 'team'
          }
        }),
        account_id: accountId,
        email: 'registered-child@example.com',
        type: 'codex' as const,
        last_refresh: '2026-06-18T00:00:00.000Z',
        expired: '2026-06-18T01:00:00.000Z',
        plan_type: 'team'
      }
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
    label: '母号 A',
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

  it('imports child session JSON and returns only redacted views', async () => {
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
      assert.equal(JSON.stringify(addedJson).includes('child-web-access-token'), false);

      const listed = await app.request('/api/subaccounts', { headers: authHeaders });
      const listedJson = (await listed.json()) as ApiResult<SubaccountView[]>;
      assert.equal(listedJson.data!.length, 1);
      assert.equal(listedJson.data![0]!.status, 'session_ready');
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

  it('updates only the child local label while preserving credentials and Team links', async () => {
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
        body: JSON.stringify({ label: '  子号备注  ' })
      });
      const body = await updated.text();
      const updatedJson = JSON.parse(body) as ApiResult<SubaccountView>;
      const stored = subaccountStore.get(subaccount.id);

      assert.equal(updated.status, 200, body);
      assert.equal(updatedJson.data!.label, '子号备注');
      assert.equal(updatedJson.data!.email, 'child@example.com');
      assert.equal(updatedJson.data!.codexCredentials.length, 1);
      assert.equal(updatedJson.data!.teamLinks.length, 1);
      assert.equal(updatedJson.data!.status, 'codex_ready');
      assert.equal(stored?.webAccessToken, 'child-web-access-token');
      assert.equal(body.includes('child-web-access-token'), false);
      assert.equal(body.includes('codex-access-token'), false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('updates child local session fields and keeps token material out of the response', async () => {
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
      await subaccountStore.update(subaccount.id, { status: 'error', lastError: '旧 session 失效' });

      const updated = await app.request(`/api/subaccounts/${subaccount.id}/local-profile`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({
          label: '新子号',
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
      assert.equal(updatedJson.data!.label, '新子号');
      assert.equal(updatedJson.data!.email, 'child-new@example.com');
      assert.equal(updatedJson.data!.chatgptAccountId, 'child-chatgpt-account-new');
      assert.equal(updatedJson.data!.lastError, undefined);
      assert.equal(stored?.email, 'child-new@example.com');
      assert.equal(stored?.chatgptAccountId, 'child-chatgpt-account-new');
      assert.equal(stored?.webAccessToken, 'child-new-web-access-token');
      assert.equal(stored?.lastError, undefined);
      assert.equal(body.includes('child-new-web-access-token'), false);
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
          label: '新子号',
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
      const logsJson = (await logs.json()) as ApiResult<Array<{ phase: string }>>;
      assert.ok(logsJson.data!.some((log) => log.phase === 'codex_auto_auth_complete'));
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

      const listed = await app.request('/api/subaccounts', { headers: authHeaders });
      const listedJson = (await listed.json()) as ApiResult<SubaccountView[]>;
      assert.equal(listedJson.data![0]!.codexCredentials[0]!.lastQuota?.windows[0]!.usedPercent, 28);
      assert.equal(typeof listedJson.data![0]!.codexCredentials[0]!.lastQuotaAt, 'number');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('registers a new child account through the worker without exposing the generated password', async () => {
    const registration = new FakeSubaccountRegistration();
    const { app, dir, authHeaders, subaccountStore } = await buildTestApp({ registration });
    try {
      const started = await app.request('/api/subaccounts/registration/start', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ mailGroup: 'clean-outlook', chatgptAccountId: 'workspace-account-id' })
      });
      assert.equal(started.status, 200);
      const startedJson = (await started.json()) as ApiResult<SubaccountView>;
      assert.equal(startedJson.data!.email, 'registered-child@example.com');
      assert.equal(startedJson.data!.status, 'codex_ready');
      assert.equal(startedJson.data!.hasWebSession, false);
      assert.equal(startedJson.data!.codexCredentials[0]!.accountId, 'workspace-account-id');
      assert.equal(JSON.stringify(startedJson).includes('generated-child-password'), false);
      assert.equal(registration.requests[0]!.mailGroup, 'clean-outlook');
      assert.equal(registration.requests[0]!.targetChatgptAccountId, 'workspace-account-id');

      const stored = subaccountStore.get(startedJson.data!.id) as unknown as { registrationPassword?: string };
      assert.equal(stored.registrationPassword, 'generated-child-password');

      const allLogs = await app.request(`/api/subaccounts/${startedJson.data!.id}/logs`, { headers: authHeaders });
      const allLogsJson = (await allLogs.json()) as ApiResult<Array<{ phase: string; message: string }>>;
      assert.ok(allLogsJson.data!.some((log) => log.phase === 'subaccount_registration_complete'));
      assert.equal(JSON.stringify(allLogsJson).includes('generated-child-password'), false);
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
      const startedJson = (await started.json()) as ApiResult<SubaccountView>;

      assert.equal(startedJson.data!.email, 'pending-child@example.com');
      assert.equal(startedJson.data!.status, 'verification_required');
      assert.match(startedJson.data!.lastError ?? '', /account_creation_failed/);
      assert.equal(JSON.stringify(startedJson).includes('generated-child-password'), false);

      const stored = subaccountStore.get(startedJson.data!.id) as unknown as { registrationPassword?: string };
      assert.equal(stored.registrationPassword, 'generated-child-password');
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
      const startedJson = (await started.json()) as ApiResult<SubaccountView>;

      assert.equal(startedJson.data!.email, 'locked-child@example.com');
      assert.equal(startedJson.data!.status, 'account_locked');
      assert.match(startedJson.data!.lastError ?? '', /account disabled/);
      assert.equal(JSON.stringify(startedJson).includes('generated-child-password'), false);

      const stored = subaccountStore.get(startedJson.data!.id) as unknown as { registrationPassword?: string };
      assert.equal(stored.registrationPassword, 'generated-child-password');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns 502 without creating a child when registration has no usable email', async () => {
    const { app, dir, authHeaders, subaccountStore } = await buildTestApp({
      registration: new FakeRegistrationEmailUnavailable()
    });
    try {
      const started = await app.request('/api/subaccounts/registration/start', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({})
      });
      const startedJson = (await started.json()) as ApiResult<SubaccountView>;

      assert.equal(started.status, 502);
      assert.equal(startedJson.ok, false);
      assert.match(startedJson.error ?? '', /No usable GongXi-Mail email/);
      assert.equal(subaccountStore.list().length, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reuses the private registration password when retrying Codex auto auth for a registered account', async () => {
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
      const startedJson = (await started.json()) as ApiResult<SubaccountView>;

      const completed = await app.request(`/api/subaccounts/${startedJson.data!.id}/codex-auth/auto`, {
        method: 'POST',
        headers: authHeaders
      });
      assert.equal(completed.status, 200);

      assert.equal(codexAutoAuth.requests[0]!.email, 'pending-child@example.com');
      assert.equal(codexAutoAuth.requests[0]!.password, 'generated-child-password');

      const logs = await app.request(`/api/subaccounts/${startedJson.data!.id}/logs`, { headers: authHeaders });
      const logsText = await logs.text();
      assert.equal(logsText.includes('generated-child-password'), false);
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
      assert.equal('accountLabel' in invitedJson.data!.teamLinks[0]!, false);
      assert.equal('chatgptAccountId' in invitedJson.data!.teamLinks[0]!, false);
      assert.equal(invitedJson.data!.teamLinks[0]!.seat, 'usage_based');
      assert.equal(invitedJson.data!.teamLinks[0]!.status, 'invited');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('falls back to mother members and pending invites for credential-only child accounts', async () => {
    const { app, dir, store, authHeaders, mother, teamTransport } = await buildTestApp();
    try {
      const invitedMother = await store.add({
        label: '母号 B',
        accountId: 'workspace-account-b',
        email: 'owner-b@example.com',
        accessToken: 'mother-b-access-token'
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
      teamTransport.invitesByWorkspaceId.set('workspace-account-b', [
        {
          id: 'invite-child',
          email_address: 'child@example.com',
          role: 'standard-user',
          status: 0,
          seat_type: 'default',
          created_time: '2026-06-18T00:00:00.000Z',
          is_scim_managed: false
        }
      ]);

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
      const syncedJson = (await synced.json()) as ApiResult<SubaccountView>;
      const links = new Map(syncedJson.data!.teamLinks.map((link) => [link.accountId, link]));

      assert.equal(synced.status, 200);
      assert.equal(links.size, 2);
      assert.equal('accountLabel' in links.get(mother.id)!, false);
      assert.equal('chatgptAccountId' in links.get(mother.id)!, false);
      assert.equal(links.get(mother.id)!.status, 'member');
      assert.equal(links.get(mother.id)!.seat, 'usage_based');
      assert.equal('accountLabel' in links.get(invitedMother.id)!, false);
      assert.equal('chatgptAccountId' in links.get(invitedMother.id)!, false);
      assert.equal(links.get(invitedMother.id)!.status, 'invited');
      assert.equal(links.get(invitedMother.id)!.seat, 'default');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('syncs child Team links from the child visible workspace list without scanning every mother', async () => {
    const { app, dir, store, authHeaders, mother, teamTransport } = await buildTestApp();
    try {
      const linkedMother = await store.add({
        label: '母号 B',
        accountId: 'workspace-account-b',
        email: 'owner-b@example.com',
        accessToken: 'mother-b-access-token'
      });
      await store.add({
        label: '母号 C',
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
        ['/backend-api/accounts/check/v4-2023-04-27?timezone_offset_min=-480']
      );
      assert.equal(teamTransport.requests[0]!.headers.Authorization, 'Bearer child-web-access-token');
      assert.equal(teamTransport.requests[0]!.headers['chatgpt-account-id'], 'child-chatgpt-account-id');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('marks an existing child Team link as removed when sync no longer finds it', async () => {
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
      assert.equal(syncedJson.data!.teamLinks.length, 1);
      assert.equal(syncedJson.data!.teamLinks[0]!.accountId, mother.id);
      assert.equal(syncedJson.data!.teamLinks[0]!.status, 'removed');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
