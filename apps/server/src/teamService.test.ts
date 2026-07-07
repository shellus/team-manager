import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AccountView, ApiResult, NotificationSettings, PublicSeatSlotView } from '@team-manager/shared';
import { AccountStore } from './accountStore.js';
import { buildApp } from './app.js';
import type { AppConfig } from './config.js';
import { SubaccountStore } from './subaccountStore.js';
import { TeamService } from './teamService.js';
import type { HttpRequest, Transport } from './transport.js';

let tempDir: string | undefined;
const originalFetch = globalThis.fetch;

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
      chatgpt_user_id: 'user-owner'
    },
    exp: 1783387600
  });
}

function localDateAfterDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

afterEach(async () => {
  globalThis.fetch = originalFetch;
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

async function buildParentApiTestApp(transport: Transport = recordingTransport()) {
  tempDir = await mkdtemp(join(tmpdir(), 'team-manager-parent-api-'));
  const config: AppConfig = {
    port: 0,
    dataDir: tempDir,
    jwtSecret: 'test-secret',
    jwtIssuer: 'team-manager',
    adminUsername: 'admin',
    apiToken: 'test-api-token',
    allowedOrigins: [],
    webDistDir: join(tempDir, 'dist')
  };
  const store = new AccountStore(tempDir);
  await store.init();
  const subaccountStore = new SubaccountStore(tempDir);
  await subaccountStore.init();
  const account = await store.add({
    remark: '原备注',
    groupName: '自用',
    accountId: 'workspace-old',
    email: 'owner-old@example.com',
    accessToken: 'old-token',
    status: 'invalid',
    workspaceName: 'Remote Team',
    lastError: '旧 token 失效'
  });
  const app = await buildApp({ config, store, subaccountStore, teamTransport: transport });
  const authHeaders = { Authorization: 'Bearer test-api-token', 'Content-Type': 'application/json' };
  return { app, store, account, authHeaders };
}

function recordingTransport(): Transport & { requests: HttpRequest[] } {
  const requests: HttpRequest[] = [];
  return {
    requests,
    async fetch(req) {
      requests.push(req);
      return { status: 200, body: '{"success":true}' };
    }
  };
}

describe('Parent account local-profile API', () => {
  it('refreshes and persists the raw parent billing snapshot', async () => {
    const transport: Transport & { requests: HttpRequest[] } = {
      requests: [],
      async fetch(req) {
        this.requests.push(req);
        if (req.path === '/backend-api/invoices?limit=10&account_id=workspace-old') {
          return {
            status: 200,
            body: JSON.stringify({
              object: 'list',
              data: [
                {
                  id: 'invoice-1',
                  amount_due: 1100,
                  currency: 'gbp',
                  next_payment_attempt: 1783728000
                }
              ]
            })
          };
        }
        if (req.path === '/backend-api/invoices/upcoming?account_id=workspace-old') {
          return {
            status: 200,
            body: JSON.stringify({
              object: 'invoice',
              status: 'draft',
              billing_reason: 'upcoming',
              amount_due: 1100,
              amount_remaining: 1100,
              currency: 'gbp',
              next_payment_attempt: 1784784000,
              lines: {
                data: [
                  {
                    description: '2 seat × ChatGPT Business Subscription',
                    quantity: 2,
                    amount: 3600,
                    currency: 'gbp',
                    period: { start: 1784700000, end: 1787378400 }
                  }
                ]
              }
            })
          };
        }
        if (req.path === '/backend-api/payments/payment_methods?account_id=workspace-old') {
          return {
            status: 200,
            body: JSON.stringify({
              data: [{ id: 'pm_1', card: { brand: 'visa', last4: '4242' } }]
            })
          };
        }
        if (req.path === '/backend-api/payments/billing_info?account_id=workspace-old') {
          return {
            status: 200,
            body: JSON.stringify({
              name: 'Billing Name',
              email: 'billing@example.com',
              address: { country: 'GB' }
            })
          };
        }
        if (req.path === '/backend-api/accounts/workspace-old/users/seat_type_counts') {
          return {
            status: 200,
            body: JSON.stringify({ seat_type_counts: { default: 3, usage_based: 1 } })
          };
        }
        return { status: 404, body: `{"error":"unexpected ${req.path}"}` };
      }
    };
    const { app, account, authHeaders } = await buildParentApiTestApp(transport);

    const refreshResponse = await app.request(`/api/accounts/${account.id}/billing/refresh`, {
      method: 'POST',
      headers: authHeaders
    });
    const refreshJson = (await refreshResponse.json()) as ApiResult<Record<string, unknown>>;
    const storedFile = JSON.parse(
      await readFile(join(tempDir!, 'account-billing-snapshots.json'), 'utf8')
    ) as Record<string, unknown>;

    assert.equal(refreshResponse.status, 200);
    assert.equal(refreshJson.data!.accountId, account.id);
    assert.equal(refreshJson.data!.workspaceAccountId, 'workspace-old');
    assert.deepEqual((refreshJson.data!.raw as Record<string, unknown>).seatTypeCounts, {
      seat_type_counts: { default: 3, usage_based: 1 }
    });
    assert.deepEqual((refreshJson.data!.raw as Record<string, unknown>).upcomingInvoice, {
      object: 'invoice',
      status: 'draft',
      billing_reason: 'upcoming',
      amount_due: 1100,
      amount_remaining: 1100,
      currency: 'gbp',
      next_payment_attempt: 1784784000,
      lines: {
        data: [
          {
            description: '2 seat × ChatGPT Business Subscription',
            quantity: 2,
            amount: 3600,
            currency: 'gbp',
            period: { start: 1784700000, end: 1787378400 }
          }
        ]
      }
    });
    assert.deepEqual((refreshJson.data!.raw as Record<string, unknown>).billingInfo, {
      name: 'Billing Name',
      email: 'billing@example.com',
      address: { country: 'GB' }
    });
    assert.deepEqual((storedFile[account.id] as Record<string, unknown>).raw, refreshJson.data!.raw);
    assert.deepEqual(transport.requests.map((request) => request.path), [
      '/backend-api/invoices?limit=10&account_id=workspace-old',
      '/backend-api/invoices/upcoming?account_id=workspace-old',
      '/backend-api/payments/payment_methods?account_id=workspace-old',
      '/backend-api/payments/billing_info?account_id=workspace-old',
      '/backend-api/accounts/workspace-old/users/seat_type_counts'
    ]);

    const getResponse = await app.request(`/api/accounts/${account.id}/billing`, {
      method: 'GET',
      headers: authHeaders
    });
    const getJson = (await getResponse.json()) as ApiResult<Record<string, unknown>>;

    assert.equal(getResponse.status, 200);
    assert.deepEqual(getJson.data, refreshJson.data);
  });

  it('updates only the local remark, group, limit type and renewal date without calling ChatGPT', async () => {
    const transport = recordingTransport();
    const { app, store, account, authHeaders } = await buildParentApiTestApp(transport);

    const response = await app.request(`/api/accounts/${account.id}/local-profile`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({
        remark: '  新备注  ',
        groupName: '  已租车位  ',
        limitType: 'monthly',
        nextRenewalOn: '2026-07-16'
      })
    });
    const json = (await response.json()) as ApiResult<AccountView>;
    const stored = store.get(account.id);
    const viewRecord = json.data as unknown as Record<string, unknown>;

    assert.equal(response.status, 200);
    assert.equal(json.data!.remark, '新备注');
    assert.equal(hasOwn(viewRecord, 'note'), false);
    assert.equal(json.data!.groupName, '已租车位');
    assert.equal(json.data!.limitType, 'monthly');
    assert.equal(json.data!.nextRenewalOn, '2026-07-16');
    assert.equal(json.data!.email, 'owner-old@example.com');
    assert.equal(stored?.remark, '新备注');
    assert.equal(stored?.groupName, '已租车位');
    assert.equal(stored?.limitType, 'monthly');
    assert.equal(stored?.nextRenewalOn, '2026-07-16');
    assert.equal(stored?.accountId, 'workspace-old');
    assert.equal(stored?.accessToken, 'old-token');
    assert.equal(stored?.workspaceName, 'Remote Team');
    assert.equal(stored?.lastError, undefined);
    assert.equal(transport.requests.length, 0);
  });

  it('updates parent proxy, returns editable session JSON, and uses that proxy for ChatGPT requests', async () => {
    const transport = recordingTransport();
    const { app, account, authHeaders } = await buildParentApiTestApp(transport);

    const response = await app.request(`/api/accounts/${account.id}/local-profile`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ proxy: '  http://parent-proxy.example:8080  ' })
    });
    const json = (await response.json()) as ApiResult<AccountView>;
    const view = json.data as unknown as Record<string, any>;

    assert.equal(response.status, 200);
    assert.equal(view.proxy, 'http://parent-proxy.example:8080');
    assert.deepEqual(view.session, {
      user: { email: 'owner-old@example.com' },
      account: { id: 'workspace-old' },
      accessToken: 'old-token'
    });

    const refreshed = await app.request(`/api/accounts/${account.id}/members/refresh`, {
      method: 'POST',
      headers: authHeaders
    });

    assert.equal(refreshed.status, 200);
    assert.equal(transport.requests[0]?.proxy, 'http://parent-proxy.example:8080');
  });

  it('creates a parent account from local profile fields plus session JSON', async () => {
    const transport: Transport & { requests: HttpRequest[] } = {
      requests: [],
      async fetch(req) {
        this.requests.push(req);
        if (req.method === 'GET' && req.path.startsWith('/backend-api/accounts/check/')) {
          return {
            status: 200,
            body: JSON.stringify({
              accounts: {
                'workspace-new': {
                  account: {
                    account_id: 'workspace-new',
                    account_user_role: 'account-owner',
                    name: 'New Team',
                    plan_type: 'team',
                    structure: 'workspace'
                  },
                  can_access_with_session: true
                }
              },
              account_ordering: ['workspace-new']
            })
          };
        }
        return { status: 404, body: '{"error":"not found"}' };
      }
    };
    const { app, store, authHeaders } = await buildParentApiTestApp(transport);

    const response = await app.request('/api/accounts', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        remark: '  新母号备注  ',
        groupName: '  已租车位  ',
        limitType: 'weekly',
        nextRenewalOn: '2026-07-16',
        proxy: '  http://parent-proxy.example:8080  ',
        session: {
          user: { email: 'owner-new@example.com' },
          account: { id: 'workspace-new' },
          accessToken: 'new-parent-access-token',
          sessionToken: 'parent-session-json-token'
        }
      })
    });
    const json = (await response.json()) as ApiResult<AccountView>;
    const stored = store.get(json.data!.id);

    assert.equal(response.status, 200);
    assert.equal(json.data!.remark, '新母号备注');
    assert.equal(json.data!.groupName, '已租车位');
    assert.equal(json.data!.limitType, 'weekly');
    assert.equal(json.data!.nextRenewalOn, '2026-07-16');
    assert.equal(json.data!.proxy, 'http://parent-proxy.example:8080');
    assert.equal(json.data!.email, 'owner-new@example.com');
    assert.equal(json.data!.accountId, 'workspace-new');
    assert.equal(stored?.remark, '新母号备注');
    assert.equal(stored?.groupName, '已租车位');
    assert.equal(stored?.limitType, 'weekly');
    assert.equal(stored?.nextRenewalOn, '2026-07-16');
    assert.equal(stored?.proxy, 'http://parent-proxy.example:8080');
    assert.equal(stored?.sessionToken, 'parent-session-json-token');
    assert.equal(transport.requests[0]?.proxy, 'http://parent-proxy.example:8080');
  });

  it('updates local session fields and returns editable session JSON', async () => {
    const transport: Transport & { requests: HttpRequest[] } = {
      requests: [],
      async fetch(req) {
        this.requests.push(req);
        if (req.method === 'GET' && req.path.startsWith('/backend-api/accounts/check/')) {
          return {
            status: 200,
            body: JSON.stringify({
              accounts: {
                'workspace-new': {
                  account: {
                    account_id: 'workspace-new',
                    account_user_role: 'account-owner',
                    name: 'New Team',
                    plan_type: 'team',
                    structure: 'workspace'
                  },
                  can_access_with_session: true
                }
              },
              account_ordering: ['workspace-new']
            })
          };
        }
        return { status: 404, body: '{"error":"not found"}' };
      }
    };
    const { app, store, account, authHeaders } = await buildParentApiTestApp(transport);

    const response = await app.request(`/api/accounts/${account.id}/local-profile`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({
        remark: '新母号备注',
        groupName: '自用',
        limitType: 'weekly',
        session: {
          user: { email: 'owner-new@example.com' },
          account: { id: 'workspace-new' },
          accessToken: 'new-parent-access-token',
          sessionToken: 'parent-session-json-token'
        }
      })
    });
    const body = await response.text();
    const json = JSON.parse(body) as ApiResult<AccountView>;
    const stored = store.get(account.id);

    assert.equal(response.status, 200);
    assert.equal(json.data!.remark, '新母号备注');
    assert.equal(json.data!.groupName, '自用');
    assert.equal(json.data!.limitType, 'weekly');
    assert.equal(json.data!.email, 'owner-new@example.com');
    assert.equal(json.data!.accountId, 'workspace-new');
    assert.equal(stored?.remark, '新母号备注');
    assert.equal(stored?.groupName, '自用');
    assert.equal(stored?.limitType, 'weekly');
    assert.equal(stored?.email, 'owner-new@example.com');
    assert.equal(stored?.accountId, 'workspace-new');
    assert.equal(stored?.accessToken, 'new-parent-access-token');
    assert.equal(stored?.sessionToken, 'parent-session-json-token');
    assert.equal(stored?.lastError, undefined);
    assert.deepEqual(json.data!.session, {
      user: { email: 'owner-new@example.com' },
      account: { id: 'workspace-new' },
      accessToken: 'new-parent-access-token',
      sessionToken: 'parent-session-json-token'
    });
  });

  it('resolves the parent workspace from accounts/check instead of trusting the session account id', async () => {
    const personalAccessToken = chatGptWebAccessToken('personal-account-id', 'free');
    const workspaceAccessToken = chatGptWebAccessToken('workspace-team-id', 'team');
    const transport: Transport & { requests: HttpRequest[] } = {
      requests: [],
      async fetch(req) {
        this.requests.push(req);
        if (req.method === 'GET' && req.path.startsWith('/backend-api/accounts/check/')) {
          return {
            status: 200,
            body: JSON.stringify({
              accounts: {
                'personal-account-id': {
                  account: {
                    account_id: 'personal-account-id',
                    account_user_role: 'account-owner',
                    name: 'Personal',
                    plan_type: 'free',
                    structure: 'personal'
                  },
                  can_access_with_session: true
                },
                'workspace-team-id': {
                  account: {
                    account_id: 'workspace-team-id',
                    account_user_role: 'account-owner',
                    name: 'Owner Team',
                    plan_type: 'team',
                    structure: 'workspace'
                  },
                  can_access_with_session: true
                }
              },
              account_ordering: ['personal-account-id', 'workspace-team-id']
            })
          };
        }
        if (req.method === 'GET' && req.path.startsWith('/api/auth/session')) {
          return {
            status: 200,
            body: JSON.stringify({
              user: { email: 'owner-new@example.com' },
              account: { id: 'workspace-team-id' },
              accessToken: workspaceAccessToken
            })
          };
        }
        return { status: 404, body: '{"error":"not found"}' };
      }
    };
    const { app, store, account, authHeaders } = await buildParentApiTestApp(transport);

    const response = await app.request(`/api/accounts/${account.id}/local-profile`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({
        session: {
          user: { email: 'owner-new@example.com' },
          account: { id: 'personal-account-id' },
          accessToken: personalAccessToken,
          sessionToken: 'parent-session-json-token'
        }
      })
    });
    const body = await response.text();
    const json = JSON.parse(body) as ApiResult<AccountView>;
    const stored = store.get(account.id);

    assert.equal(response.status, 200, body);
    assert.equal(json.data!.accountId, 'workspace-team-id');
    assert.equal(json.data!.workspaceName, 'Owner Team');
    assert.equal(stored?.accountId, 'workspace-team-id');
    assert.equal(stored?.accessToken, workspaceAccessToken);
    assert.equal(stored?.sessionToken, 'parent-session-json-token');
    assert.equal(
      transport.requests.some(
        (req) => req.path.startsWith('/api/auth/session') && (req.headers.cookie ?? '').includes('_account=workspace-team-id')
      ),
      true
    );
  });

  it('refreshes a stale replacement session token before resolving the parent workspace', async () => {
    const refreshedToken = chatGptWebAccessToken('workspace-new', 'team');
    const transport: Transport & { requests: HttpRequest[] } = {
      requests: [],
      async fetch(req) {
        this.requests.push(req);
        if (req.method === 'GET' && req.path.startsWith('/backend-api/accounts/check/')) {
          if (req.headers.Authorization === 'Bearer stale-session-access-token') {
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
          return {
            status: 200,
            body: JSON.stringify({
              accounts: {
                'workspace-new': {
                  account: {
                    account_id: 'workspace-new',
                    account_user_role: 'account-owner',
                    name: 'New Team',
                    plan_type: 'team',
                    structure: 'workspace'
                  },
                  can_access_with_session: true
                }
              },
              account_ordering: ['workspace-new']
            })
          };
        }
        if (req.method === 'GET' && req.path.startsWith('/api/auth/session')) {
          return {
            status: 200,
            body: JSON.stringify({
              user: { email: 'owner-new@example.com' },
              account: { id: 'workspace-new' },
              accessToken: refreshedToken
            })
          };
        }
        return { status: 404, body: '{"error":"not found"}' };
      }
    };
    const { app, store, account, authHeaders } = await buildParentApiTestApp(transport);

    const response = await app.request(`/api/accounts/${account.id}/local-profile`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({
        session: {
          user: { email: 'owner-new@example.com' },
          account: { id: 'workspace-new' },
          accessToken: 'stale-session-access-token',
          sessionToken: 'parent-session-json-token'
        }
      })
    });
    const body = await response.text();
    const stored = store.get(account.id);
    const accountCheckRequests = transport.requests.filter((req) => req.path.startsWith('/backend-api/accounts/check/'));

    assert.equal(response.status, 200, body);
    assert.equal(accountCheckRequests.length, 2);
    assert.equal(accountCheckRequests[0]!.headers.Authorization, 'Bearer stale-session-access-token');
    assert.equal(accountCheckRequests[1]!.headers.Authorization, `Bearer ${refreshedToken}`);
    assert.equal(stored?.accountId, 'workspace-new');
    assert.equal(stored?.accessToken, refreshedToken);
  });

  it('rejects array input for parent local session replacement', async () => {
    const transport: Transport & { requests: HttpRequest[] } = {
      requests: [],
      async fetch(req) {
        this.requests.push(req);
        return { status: 404, body: '{"error":"not found"}' };
      }
    };
    const { app, account, authHeaders } = await buildParentApiTestApp(transport);

    const response = await app.request(`/api/accounts/${account.id}/local-profile`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({
        remark: '数组输入母号',
        session: [
          { name: 'legacy-token-0', value: 'session-token-0' },
          { name: 'legacy-token-1', value: 'session-token-1' }
        ]
      })
    });
    const json = (await response.json()) as ApiResult;

    assert.equal(response.status, 400);
    assert.equal(json.ok, false);
    assert.equal(json.error, '只支持 chatgpt.com session JSON，不支持数组输入');
    assert.equal(transport.requests.length, 0);
  });

  it('returns 400 for invalid replacement parent session JSON', async () => {
    const { app, account, authHeaders } = await buildParentApiTestApp();

    const response = await app.request(`/api/accounts/${account.id}/local-profile`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({
        remark: '新母号备注',
        session: { email: 'owner-new@example.com', accessToken: 'new-parent-access-token' }
      })
    });
    const json = (await response.json()) as ApiResult;

    assert.equal(response.status, 400);
    assert.equal(json.ok, false);
    assert.equal(json.error, '缺少 user.email');
  });
});

describe('Global notification settings API', () => {
  it('returns default notification settings with an 08:00 trigger time', async () => {
    const { app, authHeaders } = await buildParentApiTestApp();

    const response = await app.request('/api/settings/notifications', {
      method: 'GET',
      headers: authHeaders
    });
    const json = (await response.json()) as ApiResult<NotificationSettings>;

    assert.equal(response.status, 200);
    assert.equal(json.data!.advanceReminderDays, 3);
    assert.equal(json.data!.triggerTime, '08:00');
    assert.equal(json.data!.channels.webhook.enabled, false);
    assert.equal(json.data!.channels.feishu.enabled, false);
    assert.equal(json.data!.channels.telegram.enabled, false);
    assert.equal(json.data!.channels.wecom.enabled, false);
  });

  it('saves notification channels and the global advance reminder days', async () => {
    const { app, authHeaders } = await buildParentApiTestApp();

    const response = await app.request('/api/settings/notifications', {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({
        advanceReminderDays: 5,
        triggerTime: '09:30',
        channels: {
          webhook: { enabled: true, url: 'https://notify.example.test/webhook' },
          feishu: { enabled: true, webhookUrl: 'https://feishu.example.test/hook' },
          telegram: { enabled: true, botToken: 'bot-token', chatId: 'chat-id' },
          wecom: { enabled: true, webhookUrl: 'https://wecom.example.test/hook' }
        }
      })
    });
    const json = (await response.json()) as ApiResult<NotificationSettings>;

    assert.equal(response.status, 200);
    assert.equal(json.data!.advanceReminderDays, 5);
    assert.equal(json.data!.triggerTime, '09:30');
    assert.equal(json.data!.channels.webhook.enabled, true);
    assert.equal(json.data!.channels.webhook.url, 'https://notify.example.test/webhook');
    assert.equal(json.data!.channels.feishu.webhookUrl, 'https://feishu.example.test/hook');
    assert.equal(json.data!.channels.telegram.botToken, 'bot-token');
    assert.equal(json.data!.channels.telegram.chatId, 'chat-id');
    assert.equal(json.data!.channels.wecom.webhookUrl, 'https://wecom.example.test/hook');
  });

  it('allows clearing saved notification channel values', async () => {
    const { app, authHeaders } = await buildParentApiTestApp();

    await app.request('/api/settings/notifications', {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({
        channels: {
          webhook: { enabled: true, url: 'https://notify.example.test/webhook' }
        }
      })
    });
    const response = await app.request('/api/settings/notifications', {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({
        channels: {
          webhook: { enabled: false, url: '' }
        }
      })
    });
    const json = (await response.json()) as ApiResult<NotificationSettings>;

    assert.equal(response.status, 200);
    assert.equal(json.data!.channels.webhook.enabled, false);
    assert.equal(json.data!.channels.webhook.url, '');
  });
});

describe('AccountStore account sanitation', () => {
  it('drops fields outside the current Account schema while preserving canonical caches', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'team-manager-store-'));
    await writeFile(
      join(tempDir, 'accounts.json'),
      JSON.stringify(
        [
          {
            id: 'account-legacy',
            remark: '母号备注',
            limitType: 'weekly',
            accountId: 'workspace-id',
            email: 'owner@example.com',
            accessToken: 'token',
            memberCount: 3,
            chatgptSeatCount: 1,
            pendingInviteCount: 2,
            membersCache: [
              {
                userId: 'user-a',
                email: 'a@example.com',
                name: '旧远端显示名',
                remoteName: '当前远端显示名',
                role: 'standard-user',
                seat: 'default'
              }
            ],
            pendingInvitesCache: [
              {
                inviteId: 'invite-a',
                email: 'pending@example.com',
                role: 'standard-user',
                status: 1,
                seat: 'usage_based',
                createdTime: '2026-06-18T00:00:00Z',
                isScimManaged: false
              }
            ],
            seatSlots: [
              {
                seatKey: 'abcd1234efgh5678',
                email: 'A@Example.com',
                remark: '已售席位',
                expiresOn: '2026-07-23',
                price: '399',
                seat: 'default',
                status: 'member',
                currentUserId: 'user-a',
                lastSwap: {
                  id: 'swap-legacy',
                  status: 'succeeded',
                  fromEmail: 'old@example.com',
                  toEmail: 'A@Example.com',
                  startedAt: 90,
                  updatedAt: 99,
                  completedAt: 99,
                  steps: [
                    {
                      key: 'inviting_new_email',
                      label: '正在添加新成员',
                      status: 'done',
                      message: 'A@Example.com',
                      at: 99
                    }
                  ]
                },
                updatedAt: 100
              },
              {
                seatKey: 'short',
                email: 'broken@example.com',
                expiresOn: '2026-07-23',
                seat: 'default',
                updatedAt: 100
              },
              {
                seatKey: 'usage1234efgh5678',
                email: 'usage@example.com',
                expiresOn: '2026-07-23',
                seat: 'usage_based',
                updatedAt: 100
              }
            ]
          }
        ],
        null,
        2
      ),
      'utf8'
    );

    const store = new AccountStore(tempDir);
    await store.init();
    const stored = store.get('account-legacy') as Record<string, unknown> | undefined;
    const persisted = JSON.parse(await readFile(join(tempDir, 'accounts.json'), 'utf8')) as Record<string, unknown>[];
    const storedMember = (stored?.membersCache as Record<string, unknown>[] | undefined)?.[0];
    const persistedMember = (persisted[0]?.membersCache as Record<string, unknown>[] | undefined)?.[0];
    const storedSlots = stored?.seatSlots as Record<string, unknown>[] | undefined;
    const persistedSlots = persisted[0]?.seatSlots as Record<string, unknown>[] | undefined;

    assert.equal(hasOwn(stored, 'memberCount'), false);
    assert.equal(hasOwn(stored, 'chatgptSeatCount'), false);
    assert.equal(hasOwn(stored, 'pendingInviteCount'), false);
    assert.equal(stored?.remark, '母号备注');
    assert.equal(stored?.groupName, '默认分组');
    assert.equal(stored?.limitType, 'weekly');
    assert.equal(hasOwn(persisted[0], 'memberCount'), false);
    assert.equal(hasOwn(persisted[0], 'chatgptSeatCount'), false);
    assert.equal(hasOwn(persisted[0], 'pendingInviteCount'), false);
    assert.equal(persisted[0]!.remark, '母号备注');
    assert.equal(persisted[0]!.groupName, '默认分组');
    assert.equal(persisted[0]!.limitType, 'weekly');
    assert.equal(hasOwn(storedMember, 'name'), false);
    assert.equal(hasOwn(persistedMember, 'name'), false);
    assert.equal(storedMember?.remoteName, '当前远端显示名');
    assert.deepEqual(stored?.membersCache, persisted[0].membersCache);
    assert.deepEqual(stored?.pendingInvitesCache, persisted[0].pendingInvitesCache);
    assert.equal(storedSlots?.length, 1);
    assert.equal(persistedSlots?.length, 1);
    assert.equal(storedSlots?.[0]?.seatKey, 'abcd1234efgh5678');
    assert.equal(storedSlots?.[0]?.email, 'a@example.com');
    assert.equal(storedSlots?.[0]?.seat, 'default');
    assert.equal(storedSlots?.[0]?.status, 'member');
    assert.equal((storedSlots?.[0]?.swapHistory as unknown[] | undefined)?.length, 1);
    assert.equal((persistedSlots?.[0]?.swapHistory as unknown[] | undefined)?.length, 1);
    assert.equal(((storedSlots?.[0]?.swapHistory as Record<string, unknown>[] | undefined)?.[0])?.id, 'swap-legacy');
  });
});

describe('TeamService account listing', () => {
  it('returns cached account views without calling ChatGPT', async () => {
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error('remote fetch should not be called while listing accounts');
    }) as typeof fetch;

    tempDir = await mkdtemp(join(tmpdir(), 'team-manager-store-'));
    const store = new AccountStore(tempDir);
    await store.init();
    await store.add({
      accountId: 'workspace-id',
      email: 'owner@example.com',
      accessToken: 'token',
      status: 'active',
      planType: 'team',
      role: 'account-owner',
      workspaceName: 'Workspace',
      membersCache: [
        {
          userId: 'user-a',
          email: 'a@example.com',
          role: 'standard-user',
          seat: 'default'
        },
        {
          userId: 'user-b',
          email: 'b@example.com',
          role: 'standard-user',
          seat: 'usage_based'
        }
      ],
      pendingInvitesCache: []
    });

    const service = new TeamService(store);
    const accounts = await service.listAccounts();

    assert.equal(fetchCalls, 0);
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].email, 'owner@example.com');
    assert.equal(accounts[0].membersCache?.length, 2);
    assert.equal(hasOwn(accounts[0], 'memberCount'), false);
    assert.equal(hasOwn(accounts[0], 'chatgptSeatCount'), false);
    assert.equal(hasOwn(accounts[0], 'pendingInviteCount'), false);
  });

  it('refreshes account status and stores the next renewal date from accounts/check entitlement', async () => {
    const requests: HttpRequest[] = [];
    const transport: Transport = {
      async fetch(req) {
        requests.push(req);
        if (req.method === 'GET' && req.path.startsWith('/backend-api/accounts/check/')) {
          return {
            status: 200,
            body: JSON.stringify({
              accounts: {
                'workspace-id': {
                  account: {
                    account_id: 'workspace-id',
                    account_user_role: 'account-owner',
                    name: 'Workspace',
                    plan_type: 'team',
                    structure: 'workspace'
                  },
                  entitlement: {
                    renews_at: '2026-07-16T06:29:16+00:00'
                  },
                  can_access_with_session: true
                }
              },
              account_ordering: ['workspace-id']
            })
          };
        }
        if (req.method === 'GET' && req.path.startsWith('/backend-api/accounts/workspace-id/users')) {
          return { status: 200, body: JSON.stringify({ items: [] }) };
        }
        return { status: 404, body: '{"error":"not found"}' };
      }
    };

    tempDir = await mkdtemp(join(tmpdir(), 'team-manager-store-'));
    const store = new AccountStore(tempDir);
    await store.init();
    const account = await store.add({
      accountId: 'workspace-id',
      email: 'owner@example.com',
      accessToken: 'token'
    });
    const service = new TeamService(store, transport);

    const view = await service.refreshAccount(account.id);

    assert.equal(view.workspaceName, 'Workspace');
    assert.equal(view.nextRenewalOn, '2026-07-16');
    assert.equal(store.get(account.id)?.nextRenewalOn, '2026-07-16');
    assert.equal(requests.length, 2);
  });
});

describe('TeamService public seat slots', () => {
  it('serves a public slot view without admin auth', async () => {
    const { app, store, account } = await buildParentApiTestApp();
    await store.update(account.id, {
      seatSlots: [
        {
          seatKey: 'abcd1234efgh5678',
          email: 'old@example.com',
          remark: '客户 A',
          expiresOn: '2026-07-23',
          price: '399',
          seat: 'default',
          status: 'member',
          currentUserId: 'user-old',
          expireRemove: false,
          expireReminder: true,
          updatedAt: 100
        }
      ]
    });

    const response = await app.request('/public/seat-slots/abcd1234efgh5678');
    const json = (await response.json()) as ApiResult<PublicSeatSlotView>;

    assert.equal(response.status, 200);
    assert.equal(json.ok, true);
    assert.deepEqual(json.data, {
      seatKey: 'abcd1234efgh5678',
      email: 'old@example.com',
      remark: '客户 A',
      expiresOn: '2026-07-23',
      price: '399',
      status: 'member'
    });
  });

  it('returns only the slot identified by the seat key', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'team-manager-seat-slot-'));
    const store = new AccountStore(tempDir);
    await store.init();
    await store.add({
      accountId: 'workspace-id',
      email: 'owner@example.com',
      accessToken: 'token',
      seatSlots: [
        {
          seatKey: 'abcd1234efgh5678',
          email: 'old@example.com',
          remark: '客户 A',
          expiresOn: '2026-07-23',
          price: '399',
          seat: 'default',
          status: 'member',
          currentUserId: 'user-old',
          expireRemove: false,
          expireReminder: true,
          updatedAt: 100
        },
        {
          seatKey: 'zzzz1234efgh5678',
          email: 'other@example.com',
          expiresOn: '2026-07-24',
          seat: 'default',
          expireRemove: false,
          expireReminder: true,
          updatedAt: 100
        }
      ]
    });
    const service = new TeamService(store, recordingTransport());

    const view = await service.getPublicSeatSlot('abcd1234efgh5678');

    assert.deepEqual(view, {
      seatKey: 'abcd1234efgh5678',
      email: 'old@example.com',
      remark: '客户 A',
      expiresOn: '2026-07-23',
      price: '399',
      status: 'member'
    });
  });

  it('swaps only the member bound to the selected slot and preserves slot metadata', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'team-manager-seat-slot-'));
    const store = new AccountStore(tempDir);
    await store.init();
    const account = await store.add({
      accountId: 'workspace-id',
      email: 'owner@example.com',
      accessToken: 'token',
      seatSlots: [
        {
          seatKey: 'abcd1234efgh5678',
          email: 'old@example.com',
          remark: '客户 A',
          expiresOn: '2026-07-23',
          price: '399',
          seat: 'default',
          status: 'member',
          currentUserId: 'user-old',
          expireRemove: false,
          expireReminder: true,
          updatedAt: 100
        },
        {
          seatKey: 'zzzz1234efgh5678',
          email: 'other@example.com',
          remark: '客户 B',
          expiresOn: '2026-07-24',
          price: '499',
          seat: 'default',
          status: 'member',
          currentUserId: 'user-other',
          expireRemove: false,
          expireReminder: true,
          updatedAt: 100
        }
      ]
    });
    const transport: Transport & { requests: HttpRequest[] } = {
      requests: [],
      async fetch(req) {
        this.requests.push(req);
        if (req.method === 'GET' && req.path.includes('/users?')) {
          return {
            status: 200,
            body: JSON.stringify({
              items: [
                { id: 'user-old', email: 'old@example.com', name: 'Old', role: 'standard-user', seat_type: 'default' },
                { id: 'user-other', email: 'other@example.com', name: 'Other', role: 'standard-user', seat_type: 'default' }
              ]
            })
          };
        }
        if (req.method === 'GET' && req.path.includes('/invites?')) {
          return { status: 200, body: JSON.stringify({ items: [] }) };
        }
        if (req.method === 'DELETE' && req.path.endsWith('/users/user-old')) {
          return { status: 200, body: JSON.stringify({ success: true }) };
        }
        if (req.method === 'POST' && req.path.endsWith('/invites')) {
          return { status: 200, body: JSON.stringify({ success: true }) };
        }
        return { status: 404, body: '{"error":"not found"}' };
      }
    };
    const service = new TeamService(store, transport);

    const view = await service.swapPublicSeatSlotEmail('abcd1234efgh5678', 'New@Example.com');
    const stored = store.get(account.id)!;
    const slot = stored.seatSlots?.find((item) => item.seatKey === 'abcd1234efgh5678');
    const otherSlot = stored.seatSlots?.find((item) => item.seatKey === 'zzzz1234efgh5678');

    assert.equal(view.email, 'new@example.com');
    assert.equal(view.remark, '客户 A');
    assert.equal(view.expiresOn, '2026-07-23');
    assert.equal(view.price, '399');
    assert.equal(slot?.email, 'new@example.com');
    assert.equal(slot?.remark, '客户 A');
    assert.equal(slot?.expiresOn, '2026-07-23');
    assert.equal(slot?.price, '399');
    assert.equal(slot?.lastSwap?.status, 'succeeded');
    assert.equal(otherSlot?.email, 'other@example.com');
    assert.equal(transport.requests.some((req) => req.method === 'DELETE' && req.path.endsWith('/users/user-other')), false);
    const inviteRequest = transport.requests.find((req) => req.method === 'POST' && req.path.endsWith('/invites'));
    assert.deepEqual(JSON.parse(inviteRequest?.body ?? '{}'), {
      email_addresses: ['new@example.com'],
      role: 'standard-user',
      seat_type: 'default',
      resend_emails: true
    });
  });

  it('keeps every swap history entry for the selected seat slot', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'team-manager-seat-slot-history-'));
    const store = new AccountStore(tempDir);
    await store.init();
    const account = await store.add({
      accountId: 'workspace-id',
      email: 'owner@example.com',
      accessToken: 'token',
      seatSlots: [
        {
          seatKey: 'abcd1234efgh5678',
          email: 'old@example.com',
          remark: '客户 A',
          expiresOn: '2026-07-23',
          price: '399',
          seat: 'default',
          status: 'member',
          currentUserId: 'user-old',
          expireRemove: false,
          expireReminder: true,
          updatedAt: 100
        },
        {
          seatKey: 'zzzz1234efgh5678',
          email: 'other@example.com',
          expiresOn: '2026-07-24',
          seat: 'default',
          status: 'member',
          currentUserId: 'user-other',
          expireRemove: false,
          expireReminder: true,
          updatedAt: 100
        }
      ]
    });
    const members = new Map([
      ['user-old', { id: 'user-old', email: 'old@example.com', name: 'Old', role: 'standard-user', seat_type: 'default' }],
      ['user-other', { id: 'user-other', email: 'other@example.com', name: 'Other', role: 'standard-user', seat_type: 'default' }]
    ]);
    const invites = new Map<string, Record<string, unknown>>();
    const transport: Transport = {
      async fetch(req) {
        if (req.method === 'GET' && req.path.includes('/users?')) {
          return { status: 200, body: JSON.stringify({ items: Array.from(members.values()) }) };
        }
        if (req.method === 'GET' && req.path.includes('/invites?')) {
          return { status: 200, body: JSON.stringify({ items: Array.from(invites.values()) }) };
        }
        if (req.method === 'DELETE' && req.path.includes('/users/')) {
          const userId = req.path.split('/').at(-1);
          if (userId) members.delete(userId);
          return { status: 200, body: JSON.stringify({ success: true }) };
        }
        if (req.method === 'DELETE' && req.path.endsWith('/invites')) {
          const body = JSON.parse(req.body ?? '{}') as { email_address?: string };
          if (body.email_address) invites.delete(body.email_address.toLowerCase());
          return { status: 200, body: JSON.stringify({ success: true }) };
        }
        if (req.method === 'POST' && req.path.endsWith('/invites')) {
          const body = JSON.parse(req.body ?? '{}') as { email_addresses?: string[] };
          const email = body.email_addresses?.[0]?.toLowerCase();
          if (email) {
            invites.set(email, {
              id: `invite-${email}`,
              email_address: email,
              role: 'standard-user',
              status: 1,
              seat_type: 'default',
              created_time: '2026-06-28T00:00:00Z',
              is_scim_managed: false
            });
          }
          return { status: 200, body: JSON.stringify({ success: true }) };
        }
        return { status: 404, body: '{"error":"not found"}' };
      }
    };
    const service = new TeamService(store, transport);

    await service.swapPublicSeatSlotEmail('abcd1234efgh5678', 'new@example.com');
    const view = await service.swapPublicSeatSlotEmail('abcd1234efgh5678', 'next@example.com');
    const slot = store.get(account.id)?.seatSlots?.find((item) => item.seatKey === 'abcd1234efgh5678');
    const history = slot?.swapHistory;

    assert.equal(history?.length, 2);
    assert.deepEqual(
      history?.map((swap) => ({ fromEmail: swap.fromEmail, toEmail: swap.toEmail, status: swap.status })),
      [
        { fromEmail: 'old@example.com', toEmail: 'new@example.com', status: 'succeeded' },
        { fromEmail: 'new@example.com', toEmail: 'next@example.com', status: 'succeeded' }
      ]
    );
    assert.equal(slot?.lastSwap?.id, history?.[1]?.id);
    assert.equal(view.swapHistory?.length, 2);
    assert.equal(view.swap?.id, view.swapHistory?.[1]?.id);
  });

  it('rejects swapping to an email bound to another slot in the same parent account', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'team-manager-seat-slot-'));
    const store = new AccountStore(tempDir);
    await store.init();
    await store.add({
      accountId: 'workspace-id',
      email: 'owner@example.com',
      accessToken: 'token',
      seatSlots: [
        {
          seatKey: 'abcd1234efgh5678',
          email: 'old@example.com',
          expiresOn: '2026-07-23',
          seat: 'default',
          expireRemove: false,
          expireReminder: true,
          updatedAt: 100
        },
        {
          seatKey: 'zzzz1234efgh5678',
          email: 'other@example.com',
          expiresOn: '2026-07-24',
          seat: 'default',
          expireRemove: false,
          expireReminder: true,
          updatedAt: 100
        }
      ]
    });
    const service = new TeamService(store, recordingTransport());

    await assert.rejects(
      () => service.swapPublicSeatSlotEmail('abcd1234efgh5678', 'other@example.com'),
      /该邮箱已绑定到同一母号的其他席位/
    );
  });
});

describe('TeamService member cache', () => {
  it('returns cached members without calling ChatGPT', async () => {
    const requests: HttpRequest[] = [];
    const transport: Transport = {
      async fetch(req) {
        requests.push(req);
        throw new Error('remote fetch should not be called while reading cached members');
      }
    };

    tempDir = await mkdtemp(join(tmpdir(), 'team-manager-store-'));
    const store = new AccountStore(tempDir);
    await store.init();
    const cachedMember = {
      userId: 'user-a',
      email: 'a@example.com',
      remoteName: 'A',
      role: 'standard-user',
      seat: 'usage_based' as const
    };
    const account = await store.add({
      accountId: 'workspace-id',
      email: 'owner@example.com',
      accessToken: 'token',
      status: 'active',
      membersCache: [cachedMember],
      membersCachedAt: 123
    });

    const service = new TeamService(store, transport);
    const members = await service.listCachedMembers(account.id);

    assert.deepEqual(members, [cachedMember]);
    assert.equal(requests.length, 0);
  });

  it('refreshes members and persists the member cache', async () => {
    const requests: HttpRequest[] = [];
    const transport: Transport = {
      async fetch(req) {
        requests.push(req);
        return {
          status: 200,
          body: JSON.stringify({
            items: [
              { id: 'user-a', email: 'a@example.com', name: 'A', role: 'standard-user', seat_type: 'default' },
              { id: 'user-b', email: 'b@example.com', name: 'B', role: 'standard-user', seat_type: 'usage_based' }
            ]
          })
        };
      }
    };

    tempDir = await mkdtemp(join(tmpdir(), 'team-manager-store-'));
    const store = new AccountStore(tempDir);
    await store.init();
    const account = await store.add({
      accountId: 'workspace-id',
      email: 'owner@example.com',
      accessToken: 'token',
      status: 'active'
    });

    const service = new TeamService(store, transport);
    const view = await service.refreshMembers(account.id);
    const stored = store.get(account.id);

    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'GET');
    assert.equal(requests[0].path, '/backend-api/accounts/workspace-id/users?offset=0&limit=25');
    assert.equal(view.membersCache?.length, 2);
    assert.deepEqual(stored?.membersCache, view.membersCache);
    assert.equal(hasOwn(stored, 'memberCount'), false);
    assert.equal(hasOwn(stored, 'chatgptSeatCount'), false);
    assert.equal(hasOwn(view, 'memberCount'), false);
    assert.equal(hasOwn(view, 'chatgptSeatCount'), false);
    assert.equal(typeof stored?.membersCachedAt, 'number');
  });
});

describe('TeamService pending invite cache', () => {
  it('returns cached pending invites without calling ChatGPT', async () => {
    const requests: HttpRequest[] = [];
    const transport: Transport = {
      async fetch(req) {
        requests.push(req);
        throw new Error('remote fetch should not be called while reading cached invites');
      }
    };

    tempDir = await mkdtemp(join(tmpdir(), 'team-manager-store-'));
    const store = new AccountStore(tempDir);
    await store.init();
    const cachedInvite = {
      inviteId: 'invite-a',
      email: 'a@example.com',
      role: 'standard-user',
      status: 1,
      seat: 'usage_based' as const,
      createdTime: '2026-06-18T00:00:00Z',
      isScimManaged: false
    };
    const account = await store.add({
      accountId: 'workspace-id',
      email: 'owner@example.com',
      accessToken: 'token',
      status: 'active',
      pendingInvitesCache: [cachedInvite],
      pendingInvitesCachedAt: 123
    });

    const service = new TeamService(store, transport);
    const invites = await service.listCachedPendingInvites(account.id);

    assert.deepEqual(invites, [cachedInvite]);
    assert.equal(requests.length, 0);
  });

  it('refreshes pending invites and persists the invite cache', async () => {
    const requests: HttpRequest[] = [];
    const transport: Transport = {
      async fetch(req) {
        requests.push(req);
        return {
          status: 200,
          body: JSON.stringify({
            items: [
              {
                id: 'invite-a',
                email_address: 'a@example.com',
                role: 'standard-user',
                status: 1,
                seat_type: 'usage_based',
                created_time: '2026-06-18T00:00:00Z',
                is_scim_managed: false
              }
            ]
          })
        };
      }
    };

    tempDir = await mkdtemp(join(tmpdir(), 'team-manager-store-'));
    const store = new AccountStore(tempDir);
    await store.init();
    const account = await store.add({
      accountId: 'workspace-id',
      email: 'owner@example.com',
      accessToken: 'token',
      status: 'active'
    });

    const service = new TeamService(store, transport);
    const view = await service.refreshPendingInvites(account.id);
    const stored = store.get(account.id);

    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'GET');
    assert.equal(requests[0].path, '/backend-api/accounts/workspace-id/invites?offset=0&limit=25&query=');
    assert.equal(view.pendingInvitesCache?.length, 1);
    assert.deepEqual(stored?.pendingInvitesCache, view.pendingInvitesCache);
    assert.equal(hasOwn(stored, 'pendingInviteCount'), false);
    assert.equal(hasOwn(view, 'pendingInviteCount'), false);
    assert.equal(typeof stored?.pendingInvitesCachedAt, 'number');
  });
});

describe('TeamService settings cache', () => {
  it('returns cached workspace settings without calling ChatGPT', async () => {
    const requests: HttpRequest[] = [];
    const transport: Transport = {
      async fetch(req) {
        requests.push(req);
        throw new Error('remote fetch should not be called while reading cached settings');
      }
    };

    tempDir = await mkdtemp(join(tmpdir(), 'team-manager-store-'));
    const store = new AccountStore(tempDir);
    await store.init();
    const account = await store.add({
      accountId: 'workspace-id',
      email: 'owner@example.com',
      accessToken: 'token',
      status: 'active',
      defaultSeat: 'usage_based',
      defaultSeatCachedAt: 123,
      workspaceReferralsEnabled: false,
      workspaceReferralsEnabledVisible: true,
      workspaceReferralsEnabledCachedAt: 123,
      personalAccessTokensEnabled: true,
      personalAccessTokensCachedAt: 123,
      codexLocalAccessEnabled: true,
      codexLocalAccessCachedAt: 123,
      codexDeviceCodeAuthEnabled: false,
      codexDeviceCodeAuthCachedAt: 123,
      codexRemoteControlEnabled: true,
      codexRemoteControlCachedAt: 123
    });

    const service = new TeamService(store, transport);
    const settings = await service.getCachedSettings(account.id);

    assert.deepEqual(settings, {
      default_seat_type: 'usage_based',
      workspace_referrals_enabled: false,
      workspace_referrals_enabled_visible: true,
      personal_access_tokens: true,
      wham_local_access: true,
      codex_device_code_auth: false,
      codex_remote_control: true
    });
    assert.equal(requests.length, 0);
  });

  it('refreshes settings and persists the workspace settings cache', async () => {
    const requests: HttpRequest[] = [];
    const transport: Transport = {
      async fetch(req) {
        requests.push(req);
        if (req.method === 'GET' && req.path.startsWith('/backend-api/accounts/check/')) {
          return {
            status: 200,
            body: JSON.stringify({
              accounts: {
                'workspace-id': {
                  account: {
                    account_id: 'workspace-id',
                    account_user_role: 'account-owner',
                    name: 'Workspace',
                    plan_type: 'team',
                    structure: 'workspace'
                  },
                  entitlement: {
                    renews_at: '2026-07-17T09:23:45+00:00'
                  },
                  can_access_with_session: true
                }
              },
              account_ordering: ['workspace-id']
            })
          };
        }
        return {
          status: 200,
          body: JSON.stringify({
            default_seat_type: 'default',
            workspace_referrals_enabled: false,
            workspace_referrals_enabled_visible: true,
            beta_settings: {
              wham_local_access: true,
              codex_device_code_auth: true,
              codex_remote_control: false,
              personal_access_tokens: true
            },
            permissions: {
              personal_access_tokens: true
            },
            extra: true
          })
        };
      }
    };

    tempDir = await mkdtemp(join(tmpdir(), 'team-manager-store-'));
    const store = new AccountStore(tempDir);
    await store.init();
    const account = await store.add({
      accountId: 'workspace-id',
      email: 'owner@example.com',
      accessToken: 'token',
      status: 'active'
    });

    const service = new TeamService(store, transport);
    const view = await service.refreshSettings(account.id);
    const stored = store.get(account.id);

    assert.equal(requests.length, 2);
    assert.equal(requests[0].method, 'GET');
    assert.equal(requests[0].path, '/backend-api/accounts/workspace-id/settings');
    assert.equal(requests[1].method, 'GET');
    assert.equal(requests[1].path.startsWith('/backend-api/accounts/check/'), true);
    assert.equal(view.defaultSeat, 'default');
    assert.equal(view.nextRenewalOn, '2026-07-17');
    assert.equal(view.workspaceReferralsEnabled, false);
    assert.equal(view.workspaceReferralsEnabledVisible, true);
    assert.equal(view.personalAccessTokensEnabled, true);
    assert.equal(view.codexLocalAccessEnabled, true);
    assert.equal(view.codexDeviceCodeAuthEnabled, true);
    assert.equal(view.codexRemoteControlEnabled, false);
    assert.equal(stored?.defaultSeat, 'default');
    assert.equal(stored?.nextRenewalOn, '2026-07-17');
    assert.equal(stored?.workspaceReferralsEnabled, false);
    assert.equal(stored?.workspaceReferralsEnabledVisible, true);
    assert.equal(stored?.personalAccessTokensEnabled, true);
    assert.equal(stored?.codexLocalAccessEnabled, true);
    assert.equal(stored?.codexDeviceCodeAuthEnabled, true);
    assert.equal(stored?.codexRemoteControlEnabled, false);
    assert.equal(typeof stored?.defaultSeatCachedAt, 'number');
    assert.equal(typeof stored?.workspaceReferralsEnabledCachedAt, 'number');
    assert.equal(typeof stored?.personalAccessTokensCachedAt, 'number');
    assert.equal(typeof stored?.codexLocalAccessCachedAt, 'number');
    assert.equal(typeof stored?.codexDeviceCodeAuthCachedAt, 'number');
    assert.equal(typeof stored?.codexRemoteControlCachedAt, 'number');
  });
});

describe('TeamService team rename', () => {
  it('patches the ChatGPT account endpoint and updates cached workspace name', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'team-manager-store-'));
    const store = new AccountStore(tempDir);
    await store.init();
    const account = await store.add({
      accountId: 'workspace-id',
      email: 'owner@example.com',
      accessToken: 'token',
      status: 'active',
      workspaceName: 'Old Team'
    });
    const requests: HttpRequest[] = [];
    const transport: Transport = {
      async fetch(req) {
        requests.push(req);
        return { status: 200, body: '{"success":true}' };
      }
    };

    const service = new TeamService(store, transport);
    const view = await service.renameTeam(account.id, 'New Team');

    assert.equal(view.workspaceName, 'New Team');
    assert.equal(store.get(account.id)?.workspaceName, 'New Team');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'PATCH');
    assert.equal(requests[0].path, '/backend-api/accounts/workspace-id');
    assert.deepEqual(JSON.parse(requests[0].body ?? '{}'), { name: 'New Team' });
  });
});

describe('TeamService member seat changes', () => {
  async function createServiceWithTransport(transport: Transport) {
    tempDir = await mkdtemp(join(tmpdir(), 'team-manager-store-'));
    const store = new AccountStore(tempDir);
    await store.init();
    const account = await store.add({
      accountId: 'workspace-id',
      email: 'owner@example.com',
      accessToken: 'token',
      status: 'active'
    });
    return { account, store, service: new TeamService(store, transport) };
  }

  it('uses the ChatGPT Web seat_type PATCH and refreshes the canonical member cache', async () => {
    const requests: HttpRequest[] = [];
    let listCalls = 0;
    const transport: Transport = {
      async fetch(req) {
        requests.push(req);
        if (req.method === 'GET' && req.path.startsWith('/backend-api/accounts/workspace-id/users')) {
          listCalls += 1;
          return {
            status: 200,
            body: JSON.stringify({
              items:
                listCalls === 1
                  ? [
                      { id: 'user-a', email: 'a@example.com', name: 'A', role: 'standard-user', seat_type: 'default' },
                      { id: 'user-b', email: 'b@example.com', name: 'B', role: 'standard-user', seat_type: 'usage_based' }
                    ]
                  : [
                      { id: 'user-a', email: 'a@example.com', name: 'A', role: 'standard-user', seat_type: 'default' },
                      { id: 'user-b', email: 'b@example.com', name: 'B', role: 'standard-user', seat_type: 'default' }
                    ]
            })
          };
        }
        return { status: 200, body: '{"success":true}' };
      }
    };
    const { account, store, service } = await createServiceWithTransport(transport);

    const view = await service.setMemberSeat(account.id, 'user-b', 'default');

    assert.equal(requests.length, 3);
    assert.equal(requests[0].method, 'GET');
    assert.equal(requests[1].method, 'PATCH');
    assert.equal(requests[1].path, '/backend-api/accounts/workspace-id/users/user-b');
    assert.deepEqual(JSON.parse(requests[1].body ?? '{}'), { seat_type: 'default' });
    assert.equal(requests[1].headers['Content-Type'], 'application/json');
    assert.equal(requests[2].method, 'GET');
    assert.equal(view.membersCache?.find((member) => member.userId === 'user-b')?.seat, 'default');
    assert.equal(store.get(account.id)?.membersCache?.find((member) => member.userId === 'user-b')?.seat, 'default');
    assert.equal(hasOwn(store.get(account.id), 'chatgptSeatCount'), false);
  });

  it('does not toggle the member when the requested seat is already current', async () => {
    const requests: HttpRequest[] = [];
    const transport: Transport = {
      async fetch(req) {
        requests.push(req);
        return {
          status: 200,
          body: JSON.stringify({
            items: [{ id: 'user-b', email: 'b@example.com', name: 'B', role: 'standard-user', seat_type: 'usage_based' }]
          })
        };
      }
    };
    const { account, store, service } = await createServiceWithTransport(transport);

    const result = await service.setMemberSeat(account.id, 'user-b', 'usage_based');

    assert.equal(result.membersCache?.[0]?.seat, 'usage_based');
    assert.equal(store.get(account.id)?.membersCache?.[0]?.seat, 'usage_based');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'GET');
  });

  it('requires confirmation before ChatGPT seat changes that may exceed the two-seat limit', async () => {
    const requests: HttpRequest[] = [];
    const transport: Transport = {
      async fetch(req) {
        requests.push(req);
        return {
          status: 200,
          body: JSON.stringify({
            items: [
              { id: 'user-a', email: 'a@example.com', name: 'A', role: 'standard-user', seat_type: 'default' },
              { id: 'user-c', email: 'c@example.com', name: 'C', role: 'standard-user', seat_type: 'default' },
              { id: 'user-b', email: 'b@example.com', name: 'B', role: 'standard-user', seat_type: 'usage_based' }
            ]
          })
        };
      }
    };
    const { account, service } = await createServiceWithTransport(transport);

    await assert.rejects(
      () => service.setMemberSeat(account.id, 'user-b', 'default'),
      /此操作将会导致超出已有席位数量/
    );
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'GET');
  });

  it('allows a confirmed ChatGPT seat change when it may exceed the two-seat limit', async () => {
    const requests: HttpRequest[] = [];
    let listCalls = 0;
    const transport: Transport = {
      async fetch(req) {
        requests.push(req);
        if (req.method === 'GET' && req.path.startsWith('/backend-api/accounts/workspace-id/users')) {
          listCalls += 1;
          return {
            status: 200,
            body: JSON.stringify({
              items:
                listCalls === 1
                  ? [
                      { id: 'user-a', email: 'a@example.com', name: 'A', role: 'standard-user', seat_type: 'default' },
                      { id: 'user-c', email: 'c@example.com', name: 'C', role: 'standard-user', seat_type: 'default' },
                      { id: 'user-b', email: 'b@example.com', name: 'B', role: 'standard-user', seat_type: 'usage_based' }
                    ]
                  : [
                      { id: 'user-a', email: 'a@example.com', name: 'A', role: 'standard-user', seat_type: 'default' },
                      { id: 'user-c', email: 'c@example.com', name: 'C', role: 'standard-user', seat_type: 'default' },
                      { id: 'user-b', email: 'b@example.com', name: 'B', role: 'standard-user', seat_type: 'default' }
                    ]
            })
          };
        }
        return { status: 200, body: '{"success":true}' };
      }
    };
    const { account, service } = await createServiceWithTransport(transport);

    const view = await service.setMemberSeat(account.id, 'user-b', 'default', true);

    assert.equal(requests.length, 3);
    assert.equal(requests[1].method, 'PATCH');
    assert.equal(requests[1].path, '/backend-api/accounts/workspace-id/users/user-b');
    assert.deepEqual(JSON.parse(requests[1].body ?? '{}'), { seat_type: 'default' });
    assert.equal(view.membersCache?.find((member) => member.userId === 'user-b')?.seat, 'default');
  });
});

describe('TeamService member removal', () => {
  it('refreshes the Web access token from saved sessionToken and retries after token_invalidated', async () => {
    const requests: HttpRequest[] = [];
    const refreshedToken = chatGptWebAccessToken('workspace-id');
    const transport: Transport = {
      async fetch(req) {
        requests.push(req);
        if (req.method === 'DELETE' && req.path === '/backend-api/accounts/workspace-id/users/user-b') {
          if (req.headers.Authorization === 'Bearer stale-token') {
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
          return { status: 200, body: '{"success":true}' };
        }
        if (req.method === 'GET' && req.path.startsWith('/api/auth/session')) {
          return {
            status: 200,
            body: JSON.stringify({
              user: { email: 'owner@example.com' },
              account: { id: 'workspace-id' },
              accessToken: refreshedToken
            })
          };
        }
        if (req.method === 'GET' && req.path.startsWith('/backend-api/accounts/workspace-id/users')) {
          return {
            status: 200,
            body: JSON.stringify({
              items: [
                { id: 'user-a', email: 'a@example.com', name: 'A', role: 'account-owner', seat_type: 'usage_based' }
              ]
            })
          };
        }
        return { status: 404, body: '{"error":"not found"}' };
      }
    };
    tempDir = await mkdtemp(join(tmpdir(), 'team-manager-store-'));
    const store = new AccountStore(tempDir);
    await store.init();
    const account = await store.add({
      accountId: 'workspace-id',
      email: 'owner@example.com',
      accessToken: 'stale-token',
      sessionToken: 'parent-session-json-token',
      status: 'active',
      membersCache: [
        { userId: 'user-a', email: 'a@example.com', role: 'account-owner', seat: 'usage_based' },
        { userId: 'user-b', email: 'b@example.com', role: 'standard-user', seat: 'default' }
      ]
    });
    const service = new TeamService(store, transport);

    const view = await service.removeMember(account.id, 'user-b');

    const deleteRequests = requests.filter((req) => req.method === 'DELETE');
    const sessionRequest = requests.find((req) => req.path.startsWith('/api/auth/session'));
    assert.equal(deleteRequests.length, 2);
    assert.equal(deleteRequests[0]!.headers.Authorization, 'Bearer stale-token');
    assert.equal(deleteRequests[1]!.headers.Authorization, `Bearer ${refreshedToken}`);
    assert.match(sessionRequest?.headers.cookie ?? '', /_account=workspace-id/);
    assert.match(sessionRequest?.headers.cookie ?? '', /__Secure-next-auth\.session-token=parent-session-json-token/);
    assert.equal(store.get(account.id)?.accessToken, refreshedToken);
    assert.deepEqual(view.membersCache?.map((member) => member.userId), ['user-a']);
  });

  it('removes a member and refreshes the canonical member cache', async () => {
    const requests: HttpRequest[] = [];
    const transport: Transport = {
      async fetch(req) {
        requests.push(req);
        if (req.method === 'GET' && req.path.startsWith('/backend-api/accounts/workspace-id/users')) {
          return {
            status: 200,
            body: JSON.stringify({
              items: [
                { id: 'user-a', email: 'a@example.com', name: 'A', role: 'account-owner', seat_type: 'usage_based' }
              ]
            })
          };
        }
        return { status: 200, body: '{"success":true}' };
      }
    };
    tempDir = await mkdtemp(join(tmpdir(), 'team-manager-store-'));
    const store = new AccountStore(tempDir);
    await store.init();
    const account = await store.add({
      accountId: 'workspace-id',
      email: 'owner@example.com',
      accessToken: 'token',
      status: 'active',
      membersCache: [
        { userId: 'user-a', email: 'a@example.com', role: 'account-owner', seat: 'usage_based' },
        { userId: 'user-b', email: 'b@example.com', role: 'standard-user', seat: 'default' }
      ]
    });
    const service = new TeamService(store, transport);

    const view = await service.removeMember(account.id, 'user-b');

    assert.equal(requests.length, 2);
    assert.equal(requests[0].method, 'DELETE');
    assert.equal(requests[0].path, '/backend-api/accounts/workspace-id/users/user-b');
    assert.equal(requests[1].method, 'GET');
    assert.deepEqual(view.membersCache?.map((member) => member.userId), ['user-a']);
    assert.deepEqual(store.get(account.id)?.membersCache?.map((member) => member.userId), ['user-a']);
    assert.equal(hasOwn(store.get(account.id), 'memberCount'), false);
  });
});

describe('TeamService default seat changes', () => {
  it('posts the default seat type to the ChatGPT Web default seat endpoint', async () => {
    const requests: HttpRequest[] = [];
    const transport: Transport = {
      async fetch(req) {
        requests.push(req);
        return { status: 200, body: '{"success":true}' };
      }
    };
    tempDir = await mkdtemp(join(tmpdir(), 'team-manager-store-'));
    const store = new AccountStore(tempDir);
    await store.init();
    const account = await store.add({
      accountId: 'workspace-id',
      email: 'owner@example.com',
      accessToken: 'token',
      status: 'active'
    });
    const service = new TeamService(store, transport);

    const view = await service.setDefaultSeat(account.id, 'usage_based');

    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].path, '/backend-api/accounts/workspace-id/settings/default_seat_type');
    assert.deepEqual(JSON.parse(requests[0].body ?? '{}'), { value: 'usage_based' });
    assert.equal(view.defaultSeat, 'usage_based');
    assert.equal(store.get(account.id)?.defaultSeat, 'usage_based');
  });
});

describe('TeamService Codex invite setting changes', () => {
  it('posts the workspace referrals toggle to the ChatGPT Web settings endpoint', async () => {
    const requests: HttpRequest[] = [];
    const transport: Transport = {
      async fetch(req) {
        requests.push(req);
        return {
          status: 200,
          body: JSON.stringify({
            workspace_referrals_enabled: false,
            workspace_referrals_enabled_visible: true
          })
        };
      }
    };
    tempDir = await mkdtemp(join(tmpdir(), 'team-manager-store-'));
    const store = new AccountStore(tempDir);
    await store.init();
    const account = await store.add({
      accountId: 'workspace-id',
      email: 'owner@example.com',
      accessToken: 'token',
      status: 'active'
    });
    const service = new TeamService(store, transport);

    const view = await service.setWorkspaceReferralsEnabled(account.id, false);

    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].path, '/backend-api/accounts/workspace-id/settings/workspace_referrals_enabled');
    assert.deepEqual(JSON.parse(requests[0].body ?? '{}'), { value: false });
    assert.equal(view.workspaceReferralsEnabled, false);
    assert.equal(view.workspaceReferralsEnabledVisible, true);
    assert.equal(store.get(account.id)?.workspaceReferralsEnabled, false);
  });
});

describe('TeamService personal access token setting changes', () => {
  it('posts the personal access token toggle to the ChatGPT Web beta features endpoint', async () => {
    const requests: HttpRequest[] = [];
    const transport: Transport = {
      async fetch(req) {
        requests.push(req);
        return {
          status: 200,
          body: JSON.stringify({
            personal_access_tokens: true
          })
        };
      }
    };
    tempDir = await mkdtemp(join(tmpdir(), 'team-manager-store-'));
    const store = new AccountStore(tempDir);
    await store.init();
    const account = await store.add({
      accountId: 'workspace-id',
      email: 'owner@example.com',
      accessToken: 'token',
      status: 'active'
    });
    const service = new TeamService(store, transport);

    const view = await service.setPersonalAccessTokensEnabled(account.id, true);

    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].path, '/backend-api/accounts/workspace-id/beta_features');
    assert.deepEqual(JSON.parse(requests[0].body ?? '{}'), {
      feature: 'personal_access_tokens',
      value: true
    });
    assert.equal(view.personalAccessTokensEnabled, true);
    assert.equal(store.get(account.id)?.personalAccessTokensEnabled, true);
  });
});

describe('TeamService Codex local access setting changes', () => {
  it('posts the Codex device code auth toggle to the ChatGPT Web beta features endpoint', async () => {
    const requests: HttpRequest[] = [];
    const transport: Transport = {
      async fetch(req) {
        requests.push(req);
        return {
          status: 200,
          body: JSON.stringify({
            codex_device_code_auth: true
          })
        };
      }
    };
    tempDir = await mkdtemp(join(tmpdir(), 'team-manager-store-'));
    const store = new AccountStore(tempDir);
    await store.init();
    const account = await store.add({
      accountId: 'workspace-id',
      email: 'owner@example.com',
      accessToken: 'token',
      status: 'active'
    });
    const service = new TeamService(store, transport);

    const view = await service.setCodexDeviceCodeAuthEnabled(account.id, true);

    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].path, '/backend-api/accounts/workspace-id/beta_features');
    assert.deepEqual(JSON.parse(requests[0].body ?? '{}'), {
      feature: 'codex_device_code_auth',
      value: true
    });
    assert.equal(view.codexDeviceCodeAuthEnabled, true);
    assert.equal(store.get(account.id)?.codexDeviceCodeAuthEnabled, true);
  });

  it('posts the Codex remote control toggle to the ChatGPT Web beta features endpoint', async () => {
    const requests: HttpRequest[] = [];
    const transport: Transport = {
      async fetch(req) {
        requests.push(req);
        return {
          status: 200,
          body: JSON.stringify({
            codex_remote_control: false
          })
        };
      }
    };
    tempDir = await mkdtemp(join(tmpdir(), 'team-manager-store-'));
    const store = new AccountStore(tempDir);
    await store.init();
    const account = await store.add({
      accountId: 'workspace-id',
      email: 'owner@example.com',
      accessToken: 'token',
      status: 'active'
    });
    const service = new TeamService(store, transport);

    const view = await service.setCodexRemoteControlEnabled(account.id, false);

    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].path, '/backend-api/accounts/workspace-id/beta_features');
    assert.deepEqual(JSON.parse(requests[0].body ?? '{}'), {
      feature: 'codex_remote_control',
      value: false
    });
    assert.equal(view.codexRemoteControlEnabled, false);
    assert.equal(store.get(account.id)?.codexRemoteControlEnabled, false);
  });
});

describe('TeamService invites', () => {
  async function createServiceWithTransport(transport: Transport) {
    tempDir = await mkdtemp(join(tmpdir(), 'team-manager-store-'));
    const store = new AccountStore(tempDir);
    await store.init();
    const account = await store.add({
      accountId: 'workspace-id',
      email: 'owner@example.com',
      accessToken: 'token',
      status: 'active'
    });
    return { account, store, service: new TeamService(store, transport) };
  }

  it('requires confirmation before inviting a ChatGPT seat when current usage is at the included seat count', async () => {
    const requests: HttpRequest[] = [];
    const transport: Transport = {
      async fetch(req) {
        requests.push(req);
        return {
          status: 200,
          body: JSON.stringify({
            items: [
              { id: 'user-a', email: 'a@example.com', name: 'A', role: 'standard-user', seat_type: 'default' },
              { id: 'user-b', email: 'b@example.com', name: 'B', role: 'standard-user', seat_type: 'default' }
            ]
          })
        };
      }
    };
    const { account, service } = await createServiceWithTransport(transport);

    await assert.rejects(
      () => service.invite(account.id, { email: 'new@example.com', seat: 'default' }),
      /此操作将会导致超出已有席位数量/
    );
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'GET');
  });

  it('allows a confirmed ChatGPT seat invite when current usage is at the included seat count', async () => {
    const requests: HttpRequest[] = [];
    const transport: Transport = {
      async fetch(req) {
        requests.push(req);
        if (req.method === 'GET' && req.path.startsWith('/backend-api/accounts/workspace-id/users')) {
          return {
            status: 200,
            body: JSON.stringify({
              items: [
                { id: 'user-a', email: 'a@example.com', name: 'A', role: 'standard-user', seat_type: 'default' },
                { id: 'user-b', email: 'b@example.com', name: 'B', role: 'standard-user', seat_type: 'default' }
              ]
            })
          };
        }
        if (req.method === 'GET' && req.path.startsWith('/backend-api/accounts/workspace-id/invites')) {
          return {
            status: 200,
            body: JSON.stringify({
              items: [
                {
                  id: 'invite-new',
                  email_address: 'new@example.com',
                  role: 'standard-user',
                  status: 1,
                  seat_type: 'default',
                  created_time: '2026-06-18T00:00:00Z',
                  is_scim_managed: false
                }
              ]
            })
          };
        }
        return { status: 200, body: '{"success":true}' };
      }
    };
    const { account, store, service } = await createServiceWithTransport(transport);

    const view = await service.invite(account.id, {
      email: 'new@example.com',
      seat: 'default',
      confirmBillingRisk: true
    });

    assert.equal(requests.length, 3);
    assert.equal(requests[1].method, 'POST');
    assert.equal(requests[1].path, '/backend-api/accounts/workspace-id/invites');
    assert.deepEqual(JSON.parse(requests[1].body ?? '{}'), {
      email_addresses: ['new@example.com'],
      role: 'standard-user',
      seat_type: 'default',
      resend_emails: true
    });
    assert.equal(requests[2].method, 'GET');
    assert.equal(view.pendingInvitesCache?.[0]?.email, 'new@example.com');
    assert.equal(store.get(account.id)?.pendingInvitesCache?.[0]?.email, 'new@example.com');
    assert.equal(hasOwn(store.get(account.id), 'pendingInviteCount'), false);
  });

  it('stores default invite metadata on a parent seat slot keyed by normalized email', async () => {
    const requests: HttpRequest[] = [];
    const transport: Transport = {
      async fetch(req) {
        requests.push(req);
        if (req.method === 'GET' && req.path.startsWith('/backend-api/accounts/workspace-id/invites')) {
          return {
            status: 200,
            body: JSON.stringify({
              items: [
                {
                  id: 'invite-new',
                  email_address: 'new@example.com',
                  role: 'standard-user',
                  status: 1,
                  seat_type: 'default',
                  created_time: '2026-06-18T00:00:00Z',
                  is_scim_managed: false
                }
              ]
            })
          };
        }
        return { status: 200, body: '{"success":true}' };
      }
    };
    const { account, store, service } = await createServiceWithTransport(transport);

    const view = await service.invite(account.id, {
      email: 'New@Example.COM',
      seat: 'default',
      memberProfile: {
        remark: '租给 Shellus',
        expiresOn: '2026-07-23',
        expireRemove: true,
        expireReminder: false
      }
    });

    const slot = view.seatSlots?.find((item) => item.email === 'new@example.com');
    assert.equal(requests.length, 3);
    assert.equal(requests[1].method, 'POST');
    assert.deepEqual(JSON.parse(requests[1].body ?? '{}'), {
      email_addresses: ['New@Example.COM'],
      role: 'standard-user',
      seat_type: 'default',
      resend_emails: true
    });
    assert.equal(slot?.remark, '租给 Shellus');
    assert.equal(slot?.expiresOn, '2026-07-23');
    assert.equal(slot?.expireRemove, true);
    assert.equal(slot?.expireReminder, false);
    assert.equal(slot?.status, 'invited');
    assert.equal(slot?.currentInviteId, 'invite-new');
    assert.match(slot?.seatKey ?? '', /^[A-Za-z0-9]{16}$/);
    assert.deepEqual(store.get(account.id)?.seatSlots, view.seatSlots);
    assert.equal(store.get(account.id)?.memberProfiles, undefined);
  });

  it('creates a 30-day expiring seat slot when a default invite omits metadata', async () => {
    const requests: HttpRequest[] = [];
    const transport: Transport = {
      async fetch(req) {
        requests.push(req);
        if (req.method === 'GET' && req.path.startsWith('/backend-api/accounts/workspace-id/invites')) {
          return {
            status: 200,
            body: JSON.stringify({
              items: [
                {
                  id: 'invite-new',
                  email_address: 'new@example.com',
                  role: 'standard-user',
                  status: 1,
                  seat_type: 'default',
                  created_time: '2026-06-18T00:00:00Z',
                  is_scim_managed: false
                }
              ]
            })
          };
        }
        return { status: 200, body: '{"success":true}' };
      }
    };
    const { account, service } = await createServiceWithTransport(transport);
    const expectedExpiresOn = localDateAfterDays(30);

    const view = await service.invite(account.id, { email: 'new@example.com', seat: 'default' });
    const slot = view.seatSlots?.find((item) => item.email === 'new@example.com');

    assert.equal(slot?.expiresOn, expectedExpiresOn);
    assert.equal(slot?.expireRemove, false);
    assert.equal(slot?.expireReminder, true);
    assert.match(slot?.seatKey ?? '', /^[A-Za-z0-9]{16}$/);
  });
});

describe('TeamService member email profiles', () => {
  it('edits the seat slot metadata for a parent email without calling ChatGPT', async () => {
    const requests: HttpRequest[] = [];
    const transport: Transport = {
      async fetch(req) {
        requests.push(req);
        throw new Error('remote fetch should not be called while editing local member metadata');
      }
    };

    tempDir = await mkdtemp(join(tmpdir(), 'team-manager-store-'));
    const store = new AccountStore(tempDir);
    await store.init();
    const account = await store.add({
      accountId: 'workspace-id',
      email: 'owner@example.com',
      accessToken: 'token',
      status: 'active',
      pendingInvitesCache: [
        {
          inviteId: 'invite-a',
          email: 'child@example.com',
          role: 'standard-user',
          status: 1,
          seat: 'usage_based',
          createdTime: '2026-06-18T00:00:00Z',
          isScimManaged: false
        }
      ],
      membersCache: [
        {
          userId: 'user-a',
          email: 'child@example.com',
          role: 'standard-user',
          seat: 'usage_based'
        }
      ],
      seatSlots: [
        {
          seatKey: 'abcd1234efgh5678',
          email: 'child@example.com',
          remark: '旧备注',
          expiresOn: '2026-07-01',
          seat: 'default',
          status: 'member',
          currentUserId: 'user-a',
          expireRemove: false,
          expireReminder: true,
          updatedAt: 100
        }
      ]
    });
    const service = new TeamService(store, transport);

    const view = await service.updateMemberProfile(account.id, ' Child@Example.com ', {
      remark: '新备注',
      expiresOn: '2026-08-01',
      expireRemove: true,
      expireReminder: false
    });

    assert.equal(requests.length, 0);
    const slot = view.seatSlots?.find((item) => item.email === 'child@example.com');
    assert.equal(slot?.seatKey, 'abcd1234efgh5678');
    assert.equal(slot?.remark, '新备注');
    assert.equal(slot?.expiresOn, '2026-08-01');
    assert.equal(slot?.expireRemove, true);
    assert.equal(slot?.expireReminder, false);
    assert.equal(store.get(account.id)?.seatSlots?.[0]?.remark, '新备注');
    assert.equal(typeof store.get(account.id)?.seatSlots?.[0]?.updatedAt, 'number');
    assert.equal(store.get(account.id)?.memberProfiles, undefined);
  });
});

describe('TeamService pending invites', () => {
  async function createServiceWithTransport(transport: Transport) {
    tempDir = await mkdtemp(join(tmpdir(), 'team-manager-store-'));
    const store = new AccountStore(tempDir);
    await store.init();
    const account = await store.add({
      accountId: 'workspace-id',
      email: 'owner@example.com',
      accessToken: 'token',
      status: 'active'
    });
    return { account, store, service: new TeamService(store, transport) };
  }

  it('lists pending invites from the ChatGPT Web invites endpoint', async () => {
    const requests: HttpRequest[] = [];
    const transport: Transport = {
      async fetch(req) {
        requests.push(req);
        return {
          status: 200,
          body: JSON.stringify({
            items: [
              {
                id: 'invite-id',
                email_address: 'pending@example.com',
                role: 'standard-user',
                status: 2,
                seat_type: 'usage_based',
                created_time: '2026-06-17T15:57:12.517604Z',
                is_scim_managed: false
              }
            ],
            total: 1,
            limit: 25,
            offset: 0
          })
        };
      }
    };
    const { account, service } = await createServiceWithTransport(transport);

    const invites = await service.listPendingInvites(account.id);

    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'GET');
    assert.equal(requests[0].path, '/backend-api/accounts/workspace-id/invites?offset=0&limit=25&query=');
    assert.deepEqual(invites, [
      {
        inviteId: 'invite-id',
        email: 'pending@example.com',
        role: 'standard-user',
        status: 2,
        seat: 'usage_based',
        createdTime: '2026-06-17T15:57:12.517604Z',
        isScimManaged: false
      }
    ]);
  });

  it('reads the pending invite count without creating a second persisted source of truth', async () => {
    const requests: HttpRequest[] = [];
    const transport: Transport = {
      async fetch(req) {
        requests.push(req);
        return {
          status: 200,
          body: JSON.stringify({
            items: [
              {
                id: 'invite-id',
                email_address: 'pending@example.com',
                role: 'standard-user',
                status: 2,
                seat_type: 'usage_based',
                created_time: '2026-06-17T15:57:12.517604Z',
                is_scim_managed: false
              }
            ],
            total: 7,
            limit: 1,
            offset: 0
          })
        };
      }
    };
    const { account, store, service } = await createServiceWithTransport(transport);

    const count = await service.countPendingInvites(account.id);

    assert.equal(count, 7);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'GET');
    assert.equal(requests[0].path, '/backend-api/accounts/workspace-id/invites?offset=0&limit=1&query=');
    assert.equal(hasOwn(store.get(account.id), 'pendingInviteCount'), false);
  });

  it('revokes a pending invite by email address and refreshes the canonical invite cache', async () => {
    const requests: HttpRequest[] = [];
    const transport: Transport = {
      async fetch(req) {
        requests.push(req);
        if (req.method === 'GET' && req.path.startsWith('/backend-api/accounts/workspace-id/invites')) {
          return {
            status: 200,
            body: JSON.stringify({
              items: [
                {
                  id: 'invite-other',
                  email_address: 'other@example.com',
                  role: 'standard-user',
                  status: 1,
                  seat_type: 'usage_based',
                  created_time: '2026-06-18T00:00:00Z',
                  is_scim_managed: false
                }
              ]
            })
          };
        }
        return { status: 200, body: '{"success":true}' };
      }
    };
    const { account, store, service } = await createServiceWithTransport(transport);

    const view = await service.revokePendingInvite(account.id, 'pending@example.com');

    assert.equal(requests.length, 2);
    assert.equal(requests[0].method, 'DELETE');
    assert.equal(requests[0].path, '/backend-api/accounts/workspace-id/invites');
    assert.deepEqual(JSON.parse(requests[0].body ?? '{}'), { email_address: 'pending@example.com' });
    assert.equal(requests[1].method, 'GET');
    assert.deepEqual(view.pendingInvitesCache?.map((invite) => invite.email), ['other@example.com']);
    assert.deepEqual(store.get(account.id)?.pendingInvitesCache?.map((invite) => invite.email), ['other@example.com']);
    assert.equal(hasOwn(store.get(account.id), 'pendingInviteCount'), false);
  });
});
