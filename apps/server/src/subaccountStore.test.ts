import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SubaccountStore } from './subaccountStore.js';
import type { CodexCredentialJson } from '@team-manager/shared';

function patCredential(accountId: string, token = `at-${accountId}`): CodexCredentialJson {
  return {
    access_token: token,
    personal_access_token: token,
    account_id: accountId,
    last_refresh: '2026-06-18T00:00:00.000Z',
    email: 'child@example.com',
    type: 'codex',
    expired: '2026-07-18T00:00:00.000Z',
    plan_type: 'team',
    auth_mode: 'personalAccessToken',
    credential_source: 'personal_access_token'
  };
}

function hasOwn(value: object | undefined, key: string): boolean {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

async function withStore(fn: (store: SubaccountStore) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'teammgr-subaccounts-'));
  try {
    const store = new SubaccountStore(dir);
    await store.init();
    await fn(store);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('SubaccountStore', () => {
  it('imports the single supported ChatGPT session JSON shape', async () => {
    await withStore(async (store) => {
      const saved = await store.importSession({
        user: { email: 'child@example.com' },
        account: { id: 'chatgpt-account-id' },
        accessToken: 'web-access-token'
      });
      const savedRecord = saved as unknown as Record<string, unknown>;

      assert.equal(saved.email, 'child@example.com');
      assert.equal(saved.remark, undefined);
      assert.equal(saved.groupName, '默认分组');
      assert.equal(hasOwn(savedRecord, 'label'), false);
      assert.equal(saved.chatgptAccountId, 'chatgpt-account-id');
      assert.equal(saved.hasWebSession, true);
      assert.equal(hasOwn(saved, 'hasCodexCredential'), false);
      assert.equal(saved.status, 'session_ready');
      assert.equal(store.list()[0]?.email, 'child@example.com');
    });
  });

  it('persists and updates the child local group independently from credential pool groups', async () => {
    await withStore(async (store) => {
      const saved = await store.importSession(
        {
          user: { email: 'grouped-child@example.com' },
          account: { id: 'chatgpt-account-id' },
          accessToken: 'web-access-token'
        },
        { groupName: '客户 A' }
      );

      assert.equal(saved.groupName, '客户 A');

      const updated = await store.updateLocalProfile(saved.id, { groupName: '客户 B' });
      assert.equal(updated?.groupName, '客户 B');
      assert.equal(store.get(saved.id)?.groupName, '客户 B');
    });
  });

  it('replaces sessionToken when re-importing a child session JSON', async () => {
    await withStore(async (store) => {
      const saved = await store.importSession({
        user: { email: 'child@example.com' },
        account: { id: 'chatgpt-account-id' },
        accessToken: 'web-access-token',
        sessionToken: 'child-session-token'
      });
      assert.equal(store.get(saved.id)?.sessionToken, 'child-session-token');

      await store.importSession({
        user: { email: 'child@example.com' },
        account: { id: 'chatgpt-account-id' },
        accessToken: 'new-web-access-token'
      });

      assert.equal(store.get(saved.id)?.sessionToken, undefined);
    });
  });

  it('keeps an existing Web Session usable when a later browser migration attempt fails', async () => {
    await withStore(async (store) => {
      const saved = await store.importSession({
        user: { email: 'legacy-child@example.com' },
        account: { id: 'legacy-account-id' },
        accessToken: 'legacy-web-access-token',
        sessionToken: 'legacy-session-token'
      });

      const failedMigration = await store.saveRegisteredSubaccount({
        email: 'legacy-child@example.com',
        password: 'saved-registration-password',
        registrationMethod: 'cloak_browser',
        status: 'error',
        lastError: 'chatgpt_auth_session_invalid_200'
      });

      assert.equal(failedMigration.id, saved.id);
      assert.equal(failedMigration.status, 'session_ready');
      assert.equal(failedMigration.session?.sessionToken, 'legacy-session-token');
      assert.equal(failedMigration.lastError, 'chatgpt_auth_session_invalid_200');
    });
  });

  it('deduplicates Team links by workspace id when the local parent id changes', async () => {
    await withStore(async (store) => {
      const saved = await store.importSession({
        user: { email: 'child@example.com' },
        account: { id: 'chatgpt-account-id' },
        accessToken: 'web-access-token'
      });

      await store.saveTeamLink(saved.id, {
        accountId: 'external-workspace-id',
        workspaceId: 'workspace-id',
        workspaceName: 'External Team',
        seat: 'usage_based',
        status: 'unknown'
      });
      const updated = await store.saveTeamLink(saved.id, {
        accountId: 'parent-record-id',
        workspaceId: 'workspace-id',
        workspaceName: 'External Team',
        seat: 'default',
        status: 'member'
      });

      assert.equal(updated!.teamLinks.length, 1);
      assert.equal(updated!.teamLinks[0]!.accountId, 'parent-record-id');
      assert.equal(updated!.teamLinks[0]!.workspaceId, 'workspace-id');
      assert.equal(updated!.teamLinks[0]!.seat, 'default');
      assert.equal(updated!.teamLinks[0]!.status, 'member');
    });
  });

  it('normalizes legacy duplicate child fields out of the persisted model', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'teammgr-subaccounts-'));
    try {
      await writeFile(
        join(dir, 'subaccounts.json'),
        JSON.stringify(
          [
            {
              id: 'child-id',
              email: 'child@example.com',
              remark: 'Child',
              chatgptAccountId: 'child-chatgpt-account-id',
              webAccessToken: 'web-access-token',
              status: 'codex_ready',
              createdAt: 1,
              updatedAt: 2,
              codexCredentials: [
                {
                  accountId: 'stale-workspace-id',
                  credential: {
                    access_token: 'at-legacy',
                    personal_access_token: 'at-legacy',
                    account_id: 'real-workspace-id',
                    last_refresh: '2026-06-18T00:00:00.000Z',
                    email: 'child@example.com',
                    type: 'codex',
                    expired: '2026-07-18T01:00:00.000Z',
                    plan_type: 'team',
                    auth_mode: 'personalAccessToken',
                    credential_source: 'personal_access_token'
                  },
                }
              ],
              teamLinks: [
                {
                  accountId: 'parent-id',
                  seat: 'usage_based',
                  status: 'member',
                  updatedAt: 20
                }
              ],
              lastQuota: {
                status: 'success',
                planType: 'team',
                windows: [{ id: 'code-five-hour', label: '5 小时', usedPercent: 42, resetAt: null }],
                error: null
              },
              lastQuotaAt: 30,
            }
          ],
          null,
          2
        ),
        'utf8'
      );

      const store = new SubaccountStore(dir);
      await store.init();
      const view = store.list()[0]!;
      const viewRecord = view as unknown as Record<string, unknown>;
      const migratedFileName = view.codexCredentials[0]!.fileName;
      const persisted = JSON.parse(await readFile(join(dir, 'subaccounts.json'), 'utf8')) as Array<{
        codexCredentials: Array<Record<string, unknown>>;
        teamLinks: Array<Record<string, unknown>>;
      }>;
      const migratedCredential = JSON.parse(
        await readFile(join(dir, 'subaccount-credentials', 'child-id', migratedFileName), 'utf8')
      ) as { personal_access_token?: string };

      assert.equal(view.codexCredentials[0]!.accountId, 'real-workspace-id');
      assert.equal(view.remark, 'Child');
      assert.equal(hasOwn(viewRecord, 'label'), false);
      assert.equal(typeof migratedFileName, 'string');
      assert.equal(view.codexCredentials[0]!.groupName, '默认号池');
      assert.equal(hasOwn(view, 'hasCodexCredential'), false);
      assert.equal(hasOwn(view, 'lastQuota'), false);
      assert.equal(hasOwn(view, 'lastQuotaAt'), false);
      assert.equal(persisted[0]!.codexCredentials[0]!.accountId, 'real-workspace-id');
      assert.equal(persisted[0]!.codexCredentials[0]!.fileName, migratedFileName);
      assert.equal(persisted[0]!.codexCredentials[0]!.groupName, '默认号池');
      assert.equal(persisted[0]!.remark, 'Child');
      assert.equal(hasOwn(persisted[0], 'label'), false);
      assert.equal(hasOwn(persisted[0]!.codexCredentials[0], 'credential'), false);
      assert.equal(migratedCredential.personal_access_token, 'at-legacy');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects flat session fields outside the ChatGPT session JSON shape', async () => {
    await withStore(async (store) => {
      await assert.rejects(
        () => store.importSession({ email: 'child@example.com', accessToken: 'web-access-token' }),
        /缺少 user.email/
      );
    });
  });

  it('stores Codex credentials separately from the redacted view', async () => {
    await withStore(async (store) => {
      const saved = await store.importSession({
        user: { email: 'child@example.com' },
        account: { id: 'chatgpt-account-id' },
        accessToken: 'web-access-token'
      });

      await store.saveCodexCredential(saved.id, patCredential('chatgpt-account-id'));

      const view = store.list()[0]!;
      assert.equal(hasOwn(view, 'hasCodexCredential'), false);
      assert.equal(view.codexCredentials.length, 1);
      assert.equal(view.codexCredentials[0]!.accountId, 'chatgpt-account-id');
      assert.equal('access_token' in view, false);
      assert.equal(store.getCodexCredential(saved.id)?.personal_access_token, 'at-chatgpt-account-id');
      assert.equal(store.getCodexCredentialForAccount(saved.id, 'chatgpt-account-id')?.personal_access_token, 'at-chatgpt-account-id');
    });
  });

  it('caches the latest quota snapshot in the redacted view across session re-imports', async () => {
    await withStore(async (store) => {
      const saved = await store.importSession({
        user: { email: 'child@example.com' },
        account: { id: 'chatgpt-account-id' },
        accessToken: 'web-access-token'
      });

      await store.saveCodexCredential(saved.id, patCredential('chatgpt-account-id'));

      const updated = await store.saveQuotaSnapshot(saved.id, 'chatgpt-account-id', {
        status: 'success',
        planType: 'team',
        windows: [{ id: 'code-five-hour', label: '5 小时', usedPercent: 42, resetAt: null }],
        error: null
      });
      assert.equal(updated!.codexCredentials[0]!.lastQuota?.windows[0]!.usedPercent, 42);
      assert.equal(typeof updated!.codexCredentials[0]!.lastQuotaAt, 'number');

      await store.importSession({
        user: { email: 'child@example.com' },
        account: { id: 'chatgpt-account-id' },
        accessToken: 'new-web-access-token'
      });
      const view = store.list()[0]!;
      assert.equal(hasOwn(view, 'lastQuota'), false);
      assert.equal(hasOwn(view, 'lastQuotaAt'), false);
      assert.equal(view.codexCredentials[0]!.lastQuota?.windows[0]!.usedPercent, 42);
    });
  });

  it('keeps the last successful quota reset time when a later seat state has no quota windows', async () => {
    await withStore(async (store) => {
      const saved = await store.importSession({
        user: { email: 'child@example.com' },
        account: { id: 'chatgpt-account-id' },
        accessToken: 'web-access-token'
      });

      await store.saveCodexCredential(saved.id, patCredential('team-account-id'));

      await store.saveQuotaSnapshot(saved.id, 'team-account-id', {
        status: 'success',
        planType: 'team',
        windows: [
          {
            id: 'code-five-hour',
            label: '5 小时',
            usedPercent: 87,
            resetAt: '2026-06-18T05:00:00.000Z'
          }
        ],
        error: null
      });
      const unavailable = await store.saveQuotaSnapshot(saved.id, 'team-account-id', {
        status: 'unavailable',
        planType: 'team',
        windows: [],
        error: 'No quota windows'
      });

      assert.equal(unavailable!.codexCredentials[0]!.lastQuota?.status, 'success');
      assert.equal(unavailable!.codexCredentials[0]!.lastQuota?.windows[0]!.usedPercent, 87);
      assert.equal(
        unavailable!.codexCredentials[0]!.lastQuota?.windows[0]!.resetAt,
        '2026-06-18T05:00:00.000Z'
      );

      const reloaded = store.list()[0]!;
      assert.equal(reloaded.codexCredentials[0]!.lastQuota?.windows[0]!.resetAt, '2026-06-18T05:00:00.000Z');
    });
  });

  it('keeps Codex credentials isolated by Team workspace account_id', async () => {
    await withStore(async (store) => {
      const saved = await store.importSession({
        user: { email: 'child@example.com' },
        account: { id: 'chatgpt-account-id' },
        accessToken: 'web-access-token'
      });

      await store.saveCodexCredential(saved.id, patCredential('team-account-a', 'at-team-a'));
      await store.saveCodexCredential(saved.id, patCredential('team-account-b', 'at-team-b'));

      assert.equal(store.list()[0]!.codexCredentials.length, 2);
      assert.equal(store.getCodexCredentialForAccount(saved.id, 'team-account-a')?.personal_access_token, 'at-team-a');
      assert.equal(store.getCodexCredentialForAccount(saved.id, 'team-account-b')?.personal_access_token, 'at-team-b');
    });
  });

  it('appends operation logs for later protocol debugging', async () => {
    await withStore(async (store) => {
      const saved = await store.importSession({
        user: { email: 'child@example.com' },
        account: { id: 'chatgpt-account-id' },
        accessToken: 'web-access-token'
      });

      await store.appendLog(saved.id, {
        phase: 'codex_pat_create_complete',
        status: 'error',
        message: 'PAT 创建失败',
        data: { workspaceId: 'chatgpt-account-id' }
      });

      const logs = store.listLogs(saved.id);
      assert.equal(logs.length, 1);
      assert.equal(logs[0]!.subaccountId, saved.id);
      assert.equal(logs[0]!.data?.workspaceId, 'chatgpt-account-id');
    });
  });
});
