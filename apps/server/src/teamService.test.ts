import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

function hasOwn(value: object | undefined, key: string): boolean {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
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
      label: 'owner-old@example.com',
      note: '原备注',
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
  it('updates only the local note and group without calling ChatGPT', async () => {
    const transport = recordingTransport();
    const { app, store, account, authHeaders } = await buildParentApiTestApp(transport);

    const response = await app.request(`/api/accounts/${account.id}/local-profile`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ note: '  新备注  ', groupName: '  已租车位  ' })
    });
    const json = (await response.json()) as ApiResult<AccountView>;
    const stored = store.get(account.id);

    assert.equal(response.status, 200);
    assert.equal(json.data!.label, 'owner-old@example.com');
    assert.equal(json.data!.note, '新备注');
    assert.equal(json.data!.groupName, '已租车位');
    assert.equal(json.data!.email, 'owner-old@example.com');
    assert.equal(stored?.label, 'owner-old@example.com');
    assert.equal(stored?.note, '新备注');
    assert.equal(stored?.groupName, '已租车位');
    assert.equal(stored?.accountId, 'workspace-old');
    assert.equal(stored?.accessToken, 'old-token');
    assert.equal(stored?.workspaceName, 'Remote Team');
    assert.equal(stored?.lastError, undefined);
    assert.equal(transport.requests.length, 0);
  });

  it('updates local session fields and keeps token material out of the response', async () => {
    const { app, store, account, authHeaders } = await buildParentApiTestApp();

    const response = await app.request(`/api/accounts/${account.id}/local-profile`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({
        note: '新母号备注',
        groupName: '自用',
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
    assert.equal(json.data!.label, 'owner-new@example.com');
    assert.equal(json.data!.note, '新母号备注');
    assert.equal(json.data!.groupName, '自用');
    assert.equal(json.data!.email, 'owner-new@example.com');
    assert.equal(json.data!.accountId, 'workspace-new');
    assert.equal(stored?.label, 'owner-new@example.com');
    assert.equal(stored?.note, '新母号备注');
    assert.equal(stored?.groupName, '自用');
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
        note: '新母号备注',
        session: { email: 'owner-new@example.com', accessToken: 'new-parent-access-token' }
      })
    });
    const json = (await response.json()) as ApiResult;

    assert.equal(response.status, 400);
    assert.equal(json.ok, false);
    assert.equal(json.error, '缺少 user.email');
  });
});

describe('AccountStore legacy account sanitation', () => {
  it('drops legacy derived count fields while preserving canonical caches', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'team-manager-store-'));
    await writeFile(
      join(tempDir, 'accounts.json'),
      JSON.stringify(
        [
          {
            id: 'account-legacy',
            label: '旧母号备注',
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

    assert.equal(hasOwn(stored, 'memberCount'), false);
    assert.equal(hasOwn(stored, 'chatgptSeatCount'), false);
    assert.equal(hasOwn(stored, 'pendingInviteCount'), false);
    assert.equal(stored?.label, 'owner@example.com');
    assert.equal(stored?.note, '旧母号备注');
    assert.equal(stored?.groupName, '默认分组');
    assert.equal(hasOwn(persisted[0], 'memberCount'), false);
    assert.equal(hasOwn(persisted[0], 'chatgptSeatCount'), false);
    assert.equal(hasOwn(persisted[0], 'pendingInviteCount'), false);
    assert.equal(persisted[0]!.label, 'owner@example.com');
    assert.equal(persisted[0]!.note, '旧母号备注');
    assert.equal(persisted[0]!.groupName, '默认分组');
    assert.deepEqual(stored?.membersCache, persisted[0].membersCache);
    assert.deepEqual(stored?.pendingInvitesCache, persisted[0].pendingInvitesCache);
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
      label: 'owner@example.com',
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
      label: 'owner@example.com',
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
      label: 'owner@example.com',
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
      personalAccessTokensCachedAt: 123
    });

    const service = new TeamService(store, transport);
    const settings = await service.getCachedSettings(account.id);

    assert.deepEqual(settings, {
      default_seat_type: 'usage_based',
      workspace_referrals_enabled: false,
      workspace_referrals_enabled_visible: true,
      personal_access_tokens: true
    });
    assert.equal(requests.length, 0);
  });

  it('refreshes settings and persists the workspace settings cache', async () => {
    const requests: HttpRequest[] = [];
    const transport: Transport = {
      async fetch(req) {
        requests.push(req);
        return {
          status: 200,
          body: JSON.stringify({
            default_seat_type: 'default',
            workspace_referrals_enabled: false,
            workspace_referrals_enabled_visible: true,
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
      label: 'owner@example.com',
      accountId: 'workspace-id',
      email: 'owner@example.com',
      accessToken: 'token',
      status: 'active'
    });

    const service = new TeamService(store, transport);
    const view = await service.refreshSettings(account.id);
    const stored = store.get(account.id);

    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'GET');
    assert.equal(requests[0].path, '/backend-api/accounts/workspace-id/settings');
    assert.equal(view.defaultSeat, 'default');
    assert.equal(view.workspaceReferralsEnabled, false);
    assert.equal(view.workspaceReferralsEnabledVisible, true);
    assert.equal(view.personalAccessTokensEnabled, true);
    assert.equal(stored?.defaultSeat, 'default');
    assert.equal(stored?.workspaceReferralsEnabled, false);
    assert.equal(stored?.workspaceReferralsEnabledVisible, true);
    assert.equal(stored?.personalAccessTokensEnabled, true);
    assert.equal(typeof stored?.defaultSeatCachedAt, 'number');
    assert.equal(typeof stored?.workspaceReferralsEnabledCachedAt, 'number');
    assert.equal(typeof stored?.personalAccessTokensCachedAt, 'number');
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
      label: 'owner@example.com',
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
      label: 'owner@example.com',
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
      label: 'owner@example.com',
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
      label: 'owner@example.com',
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
