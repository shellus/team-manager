import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
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

function oauthCredential(accountId: string): CodexCredentialJson {
  return {
    id_token: 'oauth-id-token',
    access_token: 'oauth-access-token',
    refresh_token: 'oauth-refresh-token',
    account_id: accountId,
    last_refresh: '2026-06-18T00:00:00.000Z',
    email: 'child@example.com',
    type: 'codex',
    expired: '2026-06-18T01:00:00.000Z',
    plan_type: 'team',
    auth_mode: 'chatgpt',
    credential_source: 'oauth'
  };
}

function hasOwn(value: object | undefined, key: string): boolean {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

async function withStore(fn: (store: SubaccountStore, dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'teammgr-subaccounts-'));
  try {
    const store = new SubaccountStore(dir);
    await store.init();
    await fn(store, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('SubaccountStore', () => {
  it('retains at most 30 days and 2000 child operation logs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'teammgr-subaccounts-'));
    try {
      const now = Date.now();
      const oldLog = {
        id: 'old-log',
        phase: 'test',
        status: 'success',
        message: 'old',
        createdAt: now - 31 * 24 * 60 * 60 * 1000
      };
      const recentLogs = Array.from({ length: 2_001 }, (_, index) => ({
        id: `recent-${index}`,
        phase: 'test',
        status: 'success',
        message: `recent-${index}`,
        createdAt: now - (2_001 - index)
      }));
      const logFile = join(dir, 'subaccount-auth-logs.jsonl');
      await writeFile(logFile, `${[oldLog, ...recentLogs].map((log) => JSON.stringify(log)).join('\n')}\n`);

      const store = new SubaccountStore(dir);
      await store.init();

      assert.equal(store.listLogs().length, 2_000);
      assert.equal(store.listLogs().some((log) => log.id === 'old-log'), false);
      assert.equal(store.listLogs().some((log) => log.id === 'recent-0'), false);
      assert.equal((await readFile(logFile, 'utf8')).trim().split('\n').length, 2_000);

      await store.appendLog(undefined, { phase: 'test', status: 'success', message: 'new' });

      assert.equal(store.listLogs().length, 2_000);
      assert.equal(store.listLogs().some((log) => log.id === 'recent-1'), false);
      assert.equal((await readFile(logFile, 'utf8')).trim().split('\n').length, 2_000);
      assert.equal((await stat(logFile)).mode & 0o777, 0o600);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('imports the single supported ChatGPT session JSON shape', async () => {
    await withStore(async (store, dir) => {
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
      assert.equal((await stat(join(dir, 'subaccounts.json'))).mode & 0o777, 0o600);
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

  it('links an existing Web Session to Account Manager without storing browser credentials', async () => {
    await withStore(async (store) => {
      const saved = await store.importSession({
        user: { email: 'managed-child@example.com' },
        account: { id: 'managed-account-id' },
        accessToken: 'existing-web-access-token',
        sessionToken: 'managed-session-token'
      });

      const linked = await store.saveManagedSubaccount({
        managedAccountEmail: 'managed-child@example.com',
        email: 'managed-child@example.com',
        session: {
          user: { email: 'managed-child@example.com' },
          account: { id: 'managed-account-id' },
          accessToken: 'new-web-access-token',
          sessionToken: 'managed-session-token'
        }
      });

      assert.equal(linked.id, saved.id);
      assert.equal(linked.managedAccountEmail, 'managed-child@example.com');
      assert.equal(linked.session?.accessToken, 'new-web-access-token');
      const stored = store.get(saved.id) as unknown as Record<string, unknown>;
      assert.equal(Object.hasOwn(stored, 'registrationPassword'), false);
      assert.equal(Object.hasOwn(stored, 'cloakProfileId'), false);
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

  it('rejects flat session fields outside the ChatGPT session JSON shape', async () => {
    await withStore(async (store) => {
      await assert.rejects(
        () => store.importSession({ email: 'child@example.com', accessToken: 'web-access-token' }),
        /缺少 user.email/
      );
    });
  });

  it('stores Codex credentials separately from the redacted view', async () => {
    await withStore(async (store, dir) => {
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
      const credentialFile = join(dir, 'subaccount-credentials', saved.id, view.codexCredentials[0]!.fileName);
      assert.equal((await stat(credentialFile)).mode & 0o777, 0o600);
    });
  });

  it('stores and reloads OAuth Codex credentials alongside PAT support', async () => {
    await withStore(async (store, dir) => {
      const saved = await store.importSession({
        user: { email: 'child@example.com' },
        account: { id: 'chatgpt-account-id' },
        accessToken: 'web-access-token'
      });

      await store.saveCodexCredential(saved.id, oauthCredential('workspace-account-id'));
      const fileName = store.list()[0]!.codexCredentials[0]!.fileName;
      const reloaded = new SubaccountStore(dir);
      await reloaded.init();

      const credential = reloaded.getCodexCredentialForAccount(saved.id, 'workspace-account-id');
      assert.equal(credential?.credential_source, 'oauth');
      assert.equal(credential?.auth_mode, 'chatgpt');
      assert.equal('refresh_token' in (credential ?? {}), true);
      assert.equal((await stat(join(dir, 'subaccount-credentials', saved.id, fileName))).mode & 0o777, 0o600);
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
