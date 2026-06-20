import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SubaccountStore } from './subaccountStore.js';

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

      assert.equal(saved.email, 'child@example.com');
      assert.equal(saved.label, 'child@example.com');
      assert.equal(saved.chatgptAccountId, 'chatgpt-account-id');
      assert.equal(saved.hasWebSession, true);
      assert.equal(hasOwn(saved, 'hasCodexCredential'), false);
      assert.equal(saved.status, 'session_ready');
      assert.equal(store.list()[0]?.email, 'child@example.com');
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
              label: 'Child',
              chatgptAccountId: 'child-chatgpt-account-id',
              webAccessToken: 'web-access-token',
              status: 'codex_ready',
              createdAt: 1,
              updatedAt: 2,
              codexCredentials: [
                {
                  accountId: 'stale-workspace-id',
                  credential: {
                    id_token: 'id-token',
                    access_token: 'access-token',
                    refresh_token: 'refresh-token',
                    account_id: 'real-workspace-id',
                    last_refresh: '2026-06-18T00:00:00.000Z',
                    email: 'child@example.com',
                    type: 'codex',
                    expired: '2026-06-18T01:00:00.000Z',
                    plan_type: 'team'
                  },
                  lastAuthAt: 10
                }
              ],
              teamLinks: [
                {
                  accountId: 'parent-id',
                  accountLabel: '旧母号备注',
                  chatgptAccountId: 'stale-workspace-id',
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
              lastAuthAt: 40
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
      const persisted = JSON.parse(await readFile(join(dir, 'subaccounts.json'), 'utf8')) as Array<{
        codexCredentials: Array<Record<string, unknown>>;
        teamLinks: Array<Record<string, unknown>>;
      }>;

      assert.equal(view.codexCredentials[0]!.accountId, 'real-workspace-id');
      assert.equal(hasOwn(view, 'hasCodexCredential'), false);
      assert.equal(hasOwn(view, 'lastQuota'), false);
      assert.equal(hasOwn(view, 'lastQuotaAt'), false);
      assert.equal(hasOwn(view, 'lastAuthAt'), false);
      assert.equal(hasOwn(view.teamLinks[0], 'accountLabel'), false);
      assert.equal(hasOwn(view.teamLinks[0], 'chatgptAccountId'), false);
      assert.equal(hasOwn(persisted[0]!.codexCredentials[0], 'accountId'), false);
      assert.equal(hasOwn(persisted[0]!.teamLinks[0], 'accountLabel'), false);
      assert.equal(hasOwn(persisted[0]!.teamLinks[0], 'chatgptAccountId'), false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects old flat compatibility fields', async () => {
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

      await store.saveCodexCredential(saved.id, {
        id_token: 'id-token',
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        account_id: 'chatgpt-account-id',
        last_refresh: '2026-06-18T00:00:00.000Z',
        email: 'child@example.com',
        type: 'codex',
        expired: '2026-06-18T01:00:00.000Z',
        plan_type: 'team'
      });

      const view = store.list()[0]!;
      assert.equal(hasOwn(view, 'hasCodexCredential'), false);
      assert.equal(view.codexCredentials.length, 1);
      assert.equal(view.codexCredentials[0]!.accountId, 'chatgpt-account-id');
      assert.equal('access_token' in view, false);
      assert.equal(store.getCodexCredential(saved.id)?.refresh_token, 'refresh-token');
      assert.equal(store.getCodexCredentialForAccount(saved.id, 'chatgpt-account-id')?.refresh_token, 'refresh-token');
    });
  });

  it('caches the latest quota snapshot in the redacted view across session re-imports', async () => {
    await withStore(async (store) => {
      const saved = await store.importSession({
        user: { email: 'child@example.com' },
        account: { id: 'chatgpt-account-id' },
        accessToken: 'web-access-token'
      });

      await store.saveCodexCredential(saved.id, {
        id_token: 'id-token',
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        account_id: 'chatgpt-account-id',
        last_refresh: '2026-06-18T00:00:00.000Z',
        email: 'child@example.com',
        type: 'codex',
        expired: '2026-06-18T01:00:00.000Z',
        plan_type: 'team'
      });

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

  it('keeps Codex credentials isolated by Team workspace account_id', async () => {
    await withStore(async (store) => {
      const saved = await store.importSession({
        user: { email: 'child@example.com' },
        account: { id: 'chatgpt-account-id' },
        accessToken: 'web-access-token'
      });

      await store.saveCodexCredential(saved.id, {
        id_token: 'id-token-a',
        access_token: 'access-token-a',
        refresh_token: 'refresh-token-a',
        account_id: 'team-account-a',
        last_refresh: '2026-06-18T00:00:00.000Z',
        email: 'child@example.com',
        type: 'codex',
        expired: '2026-06-18T01:00:00.000Z',
        plan_type: 'team'
      });
      await store.saveCodexCredential(saved.id, {
        id_token: 'id-token-b',
        access_token: 'access-token-b',
        refresh_token: 'refresh-token-b',
        account_id: 'team-account-b',
        last_refresh: '2026-06-18T00:00:00.000Z',
        email: 'child@example.com',
        type: 'codex',
        expired: '2026-06-18T01:00:00.000Z',
        plan_type: 'team'
      });

      assert.equal(store.list()[0]!.codexCredentials.length, 2);
      assert.equal(store.getCodexCredentialForAccount(saved.id, 'team-account-a')?.refresh_token, 'refresh-token-a');
      assert.equal(store.getCodexCredentialForAccount(saved.id, 'team-account-b')?.refresh_token, 'refresh-token-b');
    });
  });

  it('appends redacted auth logs for later protocol debugging', async () => {
    await withStore(async (store) => {
      const saved = await store.importSession({
        user: { email: 'child@example.com' },
        account: { id: 'chatgpt-account-id' },
        accessToken: 'web-access-token'
      });

      await store.appendLog(saved.id, {
        phase: 'codex_auth_callback',
        status: 'verification_required',
        message: '需要邮箱验证码',
        data: { fields: ['email_otp'] }
      });

      const logs = store.listLogs(saved.id);
      assert.equal(logs.length, 1);
      assert.equal(logs[0]!.subaccountId, saved.id);
      assert.equal(logs[0]!.data?.fields?.[0], 'email_otp');
    });
  });
});
