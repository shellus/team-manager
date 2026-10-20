import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Pool } from 'pg';
import { createDatabase } from './database/connection.js';
import { migrateToLatest } from './database/migrator.js';
import { AccountRepository } from './repositories/accountRepository.js';
import { WorkspaceRepository } from './repositories/workspaceRepository.js';
import { SessionRepository } from './repositories/sessionRepository.js';
import { SecretCipher } from './secretCipher.js';
import { buildUnifiedApp } from './unifiedApp.js';

const adminUrl = process.env.TEAMMGR_TEST_ADMIN_DATABASE_URL;

test('移除首选 Owner 原子修复指针，失效首选不阻断空间回读', { skip: !adminUrl, timeout: 60_000 }, async () => {
  const name = `team_manager_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  const url = new URL(adminUrl!); url.pathname = `/${name}`;
  const artifactDir = await mkdtemp(join(tmpdir(), 'preferred-manager-test-'));
  try {
    await admin.query(`create database "${name}"`);
    const db = createDatabase({ connectionString: url.toString() });
    try {
      await migrateToLatest(db);
      const accounts = new AccountRepository(db);
      const workspaces = new WorkspaceRepository(db);
      const owner = (await accounts.create({ email: 'original@example.com' })).account;
      const executor = (await accounts.create({ email: 'z-executor@example.com' })).account;
      const other = (await accounts.create({ email: 'a-other@example.com' })).account;
      const workspace = await workspaces.upsert({ externalId: 'preferred-manager-test', normalizedPlan: 'business' });
      const sessions = new SessionRepository(db, new SecretCipher('0'.repeat(64), 'test-v1'));
      await sessions.saveAccessToken(executor.id, { kind: 'workspace', workspaceId: workspace.id }, 'test-token', { status: 'valid' });
      let failDelete = false, failRefresh = false;
      let remoteMembers: Array<{ id: string; email: string; role: string }> = [];
      let mutations = 0;
      const app = await buildUnifiedApp({
        database: db,
        config: { port: 0, dataDir: artifactDir, artifactDir, databaseUrl: url.toString(), dataEncryptionKey: '0'.repeat(64), dataEncryptionKeyVersion: 'test-v1', jwtSecret: 'secret', jwtIssuer: 'team-manager', adminUsername: 'admin', adminPasswordHash: 'unused', apiToken: 'test-token', allowedOrigins: [], webDistDir: '/missing' },
        transport: { fetch: async (request) => {
          if (request.method === 'DELETE' && request.path.endsWith('/users/removed-owner')) {
            mutations++;
            return { status: 200, body: JSON.stringify({ success: !failDelete }) };
          }
          if (request.method === 'GET' && request.path.includes('/users?')) {
            if (failRefresh) return { status: 503, body: '{}' };
            return { status: 200, body: JSON.stringify({ items: remoteMembers }) };
          }
          throw new Error(`Unexpected upstream request: ${request.method} ${request.path}`);
        } }
      });
      const headers = { authorization: 'Bearer test-token', 'content-type': 'application/json' };
      const preferred = async () => (await workspaces.findById(workspace.id))!.preferred_manager_account_id;
      const seed = async (executorRole: 'owner' | 'admin', includeOther: boolean) => {
        await db.deleteFrom('workspace_memberships').where('workspace_id', '=', workspace.id).execute();
        remoteMembers = [];
        for (const [account, remoteUserId, role] of [
          [owner, 'removed-owner', 'owner'], [executor, 'executor', executorRole],
          ...(includeOther ? [[other, 'other', 'owner'] as const] : [])
        ] as const) {
          await workspaces.upsertMembership({ workspaceId: workspace.id, accountId: account.id, remoteUserId, email: account.email, normalizedRole: role, observedAt: new Date(), source: 'test' });
          if (account.id !== owner.id) remoteMembers.push({ id: remoteUserId, email: account.email, role: role === 'owner' ? 'account-owner' : 'account-admin' });
        }
        await db.updateTable('workspaces').set({ preferred_manager_account_id: owner.id }).where('id', '=', workspace.id).execute();
      };
      const remove = () => app.request(`/api/workspaces/${workspace.id}/members/removed-owner`, {
        method: 'DELETE', headers, body: JSON.stringify({ executorAccountId: executor.id })
      });
      const read = async () => {
        const response = await app.request(`/api/workspaces/${workspace.id}`, { headers });
        assert.equal(response.status, 200, await response.clone().text());
        return (await response.json() as any).data;
      };
      await seed('owner', true);
      failDelete = true;
      assert.equal((await remove()).status, 502);
      assert.equal(await preferred(), owner.id, '上游拒绝不改首选或关系');
      assert.equal((await db.selectFrom('workspace_memberships').select('status').where('account_id', '=', owner.id).executeTakeFirstOrThrow()).status, 'active');
      failDelete = false;
      const response = await remove();
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal((await response.json() as any).data.workspace.preferredManagerAccountId, executor.id);
      assert.equal(await preferred(), executor.id, '优先执行人而非邮箱排序更早的 Owner');
      assert.equal((await read()).preferredManagerMissing, false);

      await seed('admin', true);
      assert.equal((await remove()).status, 200);
      assert.equal(await preferred(), other.id, '执行人是 admin 时选择活动自有 Owner');
      await seed('admin', false);
      assert.equal((await remove()).status, 200);
      assert.equal(await preferred(), null);
      assert.equal((await read()).preferredManagerMissing, true);

      await seed('owner', true);
      failRefresh = true;
      assert.equal((await remove()).status, 502);
      assert.equal(await preferred(), executor.id, '后续刷新失败仍不能留下悬空首选');
      failRefresh = false;
      await seed('owner', true);
      await db.updateTable('workspace_memberships').set({ status: 'removed' }).where('account_id', '=', owner.id).execute();
      const beforeReads = mutations;
      const stale = await read();
      assert.equal(stale.preferredManagerMissing, true);
      assert.equal(stale.preferredManagerAccountId, undefined);
      assert.ok(stale.members.length);
      assert.equal(await preferred(), owner.id, '只读不静默修复历史数据');
      assert.equal(mutations, beforeReads);
      assert.equal((await app.request(`/api/workspaces/${randomUUID()}`, { headers })).status, 404);
      assert.equal((await app.request(`/api/accounts/${owner.id}/workspaces/${workspace.id}`, { headers })).status, 404, '账号成员关系读取仍保持原有边界');

      await seed('owner', true);
      await db.updateTable('workspaces').set({ preferred_manager_account_id: other.id }).where('id', '=', workspace.id).execute();
      assert.equal((await remove()).status, 200);
      assert.equal(await preferred(), other.id, '移除非首选成员保留原首选');
    } finally { await db.destroy(); }
  } finally {
    await admin.query(`drop database if exists "${name}" with (force)`);
    await admin.end();
    await rm(artifactDir, { recursive: true, force: true });
  }
});
