import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AccountView, ApiResult } from '@team-manager/shared';
import { AccountStore } from './accountStore.js';
import { buildApp } from './app.js';
import type { AppConfig } from './config.js';
import { SubaccountStore } from './subaccountStore.js';
import { TeamService } from './teamService.js';
import type { HttpRequest, Transport } from './transport.js';

let tempDir: string | undefined;
const originalFetch = globalThis.fetch;

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
    label: '原备注',
    accountId: 'workspace-old',
    email: 'owner-old@example.com',
    accessToken: 'old-token',
    status: 'invalid',
    workspaceName: 'Remote Team',
    memberCount: 2,
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
  it('updates only the local label without calling ChatGPT', async () => {
    const transport = recordingTransport();
    const { app, store, account, authHeaders } = await buildParentApiTestApp(transport);

    const response = await app.request(`/api/accounts/${account.id}/local-profile`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ label: '  新备注  ' })
    });
    const json = (await response.json()) as ApiResult<AccountView>;
    const stored = store.get(account.id);

    assert.equal(response.status, 200);
    assert.equal(json.data!.label, '新备注');
    assert.equal(json.data!.email, 'owner-old@example.com');
    assert.equal(stored?.label, '新备注');
    assert.equal(stored?.accountId, 'workspace-old');
    assert.equal(stored?.accessToken, 'old-token');
    assert.equal(stored?.workspaceName, 'Remote Team');
    assert.equal(stored?.memberCount, 2);
    assert.equal(stored?.lastError, undefined);
    assert.equal(transport.requests.length, 0);
  });

  it('updates local session fields and keeps token material out of the response', async () => {
    const { app, store, account, authHeaders } = await buildParentApiTestApp();

    const response = await app.request(`/api/accounts/${account.id}/local-profile`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({
        label: '新母号',
        session: {
          user: { email: 'owner-new@example.com' },
          account: { id: 'workspace-new' },
          accessToken: 'new-parent-access-token'
        }
      })
    });
    const body = await response.text();
    const json = JSON.parse(body) as ApiResult<AccountView>;
    const stored = store.get(account.id);

    assert.equal(response.status, 200);
    assert.equal(json.data!.label, '新母号');
    assert.equal(json.data!.email, 'owner-new@example.com');
    assert.equal(json.data!.accountId, 'workspace-new');
    assert.equal(stored?.email, 'owner-new@example.com');
    assert.equal(stored?.accountId, 'workspace-new');
    assert.equal(stored?.accessToken, 'new-parent-access-token');
    assert.equal(stored?.lastError, undefined);
    assert.equal(body.includes('new-parent-access-token'), false);
  });

  it('returns 400 for invalid replacement parent session JSON', async () => {
    const { app, account, authHeaders } = await buildParentApiTestApp();

    const response = await app.request(`/api/accounts/${account.id}/local-profile`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({
        label: '新母号',
        session: { email: 'owner-new@example.com', accessToken: 'new-parent-access-token' }
      })
    });
    const json = (await response.json()) as ApiResult;

    assert.equal(response.status, 400);
    assert.equal(json.ok, false);
    assert.equal(json.error, '缺少 user.email');
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
      label: 'owner@example.com',
      accountId: 'workspace-id',
      email: 'owner@example.com',
      accessToken: 'token',
      status: 'active',
      planType: 'team',
      role: 'account-owner',
      workspaceName: 'Workspace',
      memberCount: 3,
      chatgptSeatCount: 1
    });

    const service = new TeamService(store);
    const accounts = await service.listAccounts();

    assert.equal(fetchCalls, 0);
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].email, 'owner@example.com');
    assert.equal(accounts[0].memberCount, 3);
    assert.equal(accounts[0].chatgptSeatCount, 1);
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
      name: 'A',
      role: 'standard-user',
      seat: 'usage_based' as const
    };
    const account = await store.add({
      label: 'owner@example.com',
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
      label: 'owner@example.com',
      accountId: 'workspace-id',
      email: 'owner@example.com',
      accessToken: 'token',
      status: 'active'
    });

    const service = new TeamService(store, transport);
    const members = await service.refreshMembers(account.id);
    const stored = store.get(account.id);

    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'GET');
    assert.equal(requests[0].path, '/backend-api/accounts/workspace-id/users?offset=0&limit=25');
    assert.equal(members.length, 2);
    assert.deepEqual(stored?.membersCache, members);
    assert.equal(stored?.memberCount, 2);
    assert.equal(stored?.chatgptSeatCount, 1);
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
      label: 'owner@example.com',
      accountId: 'workspace-id',
      email: 'owner@example.com',
      accessToken: 'token',
      status: 'active',
      pendingInviteCount: 1,
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
      label: 'owner@example.com',
      accountId: 'workspace-id',
      email: 'owner@example.com',
      accessToken: 'token',
      status: 'active'
    });

    const service = new TeamService(store, transport);
    const invites = await service.refreshPendingInvites(account.id);
    const stored = store.get(account.id);

    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'GET');
    assert.equal(requests[0].path, '/backend-api/accounts/workspace-id/invites?offset=0&limit=25&query=');
    assert.equal(invites.length, 1);
    assert.deepEqual(stored?.pendingInvitesCache, invites);
    assert.equal(stored?.pendingInviteCount, 1);
    assert.equal(typeof stored?.pendingInvitesCachedAt, 'number');
  });
});

describe('TeamService settings cache', () => {
  it('returns cached default seat settings without calling ChatGPT', async () => {
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
      label: 'owner@example.com',
      accountId: 'workspace-id',
      email: 'owner@example.com',
      accessToken: 'token',
      status: 'active',
      defaultSeat: 'usage_based',
      defaultSeatCachedAt: 123
    });

    const service = new TeamService(store, transport);
    const settings = await service.getCachedSettings(account.id);

    assert.deepEqual(settings, { default_seat_type: 'usage_based' });
    assert.equal(requests.length, 0);
  });

  it('refreshes settings and persists the default seat cache', async () => {
    const requests: HttpRequest[] = [];
    const transport: Transport = {
      async fetch(req) {
        requests.push(req);
        return { status: 200, body: JSON.stringify({ default_seat_type: 'default', extra: true }) };
      }
    };

    tempDir = await mkdtemp(join(tmpdir(), 'team-manager-store-'));
    const store = new AccountStore(tempDir);
    await store.init();
    const account = await store.add({
      label: 'owner@example.com',
      accountId: 'workspace-id',
      email: 'owner@example.com',
      accessToken: 'token',
      status: 'active'
    });

    const service = new TeamService(store, transport);
    const settings = await service.refreshSettings(account.id);
    const stored = store.get(account.id);

    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'GET');
    assert.equal(requests[0].path, '/backend-api/accounts/workspace-id/settings');
    assert.deepEqual(settings, { default_seat_type: 'default', extra: true });
    assert.equal(stored?.defaultSeat, 'default');
    assert.equal(typeof stored?.defaultSeatCachedAt, 'number');
  });
});

describe('TeamService team rename', () => {
  it('patches the ChatGPT account endpoint and updates cached workspace name', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'team-manager-store-'));
    const store = new AccountStore(tempDir);
    await store.init();
    const account = await store.add({
      label: 'owner@example.com',
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
      label: 'owner@example.com',
      accountId: 'workspace-id',
      email: 'owner@example.com',
      accessToken: 'token',
      status: 'active'
    });
    return { account, service: new TeamService(store, transport) };
  }

  it('uses the ChatGPT Web seat_type PATCH after checking current seats', async () => {
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
                { id: 'user-b', email: 'b@example.com', name: 'B', role: 'standard-user', seat_type: 'usage_based' }
              ]
            })
          };
        }
        return { status: 200, body: '{"success":true}' };
      }
    };
    const { account, service } = await createServiceWithTransport(transport);

    await service.setMemberSeat(account.id, 'user-b', 'default');

    assert.equal(requests.length, 2);
    assert.equal(requests[0].method, 'GET');
    assert.equal(requests[1].method, 'PATCH');
    assert.equal(requests[1].path, '/backend-api/accounts/workspace-id/users/user-b');
    assert.deepEqual(JSON.parse(requests[1].body ?? '{}'), { seat_type: 'default' });
    assert.equal(requests[1].headers['Content-Type'], 'application/json');
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
    const { account, service } = await createServiceWithTransport(transport);

    const result = await service.setMemberSeat(account.id, 'user-b', 'usage_based');

    assert.deepEqual(result, { success: true, skipped: true });
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
    const transport: Transport = {
      async fetch(req) {
        requests.push(req);
        if (req.method === 'GET' && req.path.startsWith('/backend-api/accounts/workspace-id/users')) {
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
        return { status: 200, body: '{"success":true}' };
      }
    };
    const { account, service } = await createServiceWithTransport(transport);

    await service.setMemberSeat(account.id, 'user-b', 'default', true);

    assert.equal(requests.length, 2);
    assert.equal(requests[1].method, 'PATCH');
    assert.equal(requests[1].path, '/backend-api/accounts/workspace-id/users/user-b');
    assert.deepEqual(JSON.parse(requests[1].body ?? '{}'), { seat_type: 'default' });
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
      label: 'owner@example.com',
      accountId: 'workspace-id',
      email: 'owner@example.com',
      accessToken: 'token',
      status: 'active'
    });
    const service = new TeamService(store, transport);

    await service.setDefaultSeat(account.id, 'usage_based');

    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].path, '/backend-api/accounts/workspace-id/settings/default_seat_type');
    assert.deepEqual(JSON.parse(requests[0].body ?? '{}'), { value: 'usage_based' });
  });
});

describe('TeamService invites', () => {
  async function createServiceWithTransport(transport: Transport) {
    tempDir = await mkdtemp(join(tmpdir(), 'team-manager-store-'));
    const store = new AccountStore(tempDir);
    await store.init();
    const account = await store.add({
      label: 'owner@example.com',
      accountId: 'workspace-id',
      email: 'owner@example.com',
      accessToken: 'token',
      status: 'active'
    });
    return { account, service: new TeamService(store, transport) };
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
        return { status: 200, body: '{"success":true}' };
      }
    };
    const { account, service } = await createServiceWithTransport(transport);

    await service.invite(account.id, {
      email: 'new@example.com',
      seat: 'default',
      confirmBillingRisk: true
    });

    assert.equal(requests.length, 2);
    assert.equal(requests[1].method, 'POST');
    assert.equal(requests[1].path, '/backend-api/accounts/workspace-id/invites');
    assert.deepEqual(JSON.parse(requests[1].body ?? '{}'), {
      email_addresses: ['new@example.com'],
      role: 'standard-user',
      seat_type: 'default',
      resend_emails: true
    });
  });
});

describe('TeamService pending invites', () => {
  async function createServiceWithTransport(transport: Transport) {
    tempDir = await mkdtemp(join(tmpdir(), 'team-manager-store-'));
    const store = new AccountStore(tempDir);
    await store.init();
    const account = await store.add({
      label: 'owner@example.com',
      accountId: 'workspace-id',
      email: 'owner@example.com',
      accessToken: 'token',
      status: 'active'
    });
    return { account, service: new TeamService(store, transport) };
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

  it('reads and caches only the pending invite count', async () => {
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
    const { account, service } = await createServiceWithTransport(transport);

    const count = await service.countPendingInvites(account.id);

    assert.equal(count, 7);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'GET');
    assert.equal(requests[0].path, '/backend-api/accounts/workspace-id/invites?offset=0&limit=1&query=');
  });

  it('revokes a pending invite by email address', async () => {
    const requests: HttpRequest[] = [];
    const transport: Transport = {
      async fetch(req) {
        requests.push(req);
        return { status: 200, body: '{"success":true}' };
      }
    };
    const { account, service } = await createServiceWithTransport(transport);

    await service.revokePendingInvite(account.id, 'pending@example.com');

    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'DELETE');
    assert.equal(requests[0].path, '/backend-api/accounts/workspace-id/invites');
    assert.deepEqual(JSON.parse(requests[0].body ?? '{}'), { email_address: 'pending@example.com' });
  });
});
