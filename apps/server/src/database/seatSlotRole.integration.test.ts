import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { createDatabase } from './connection.js';
import { createMigrator, migrateToLatest } from './migrator.js';
import { AccountRepository } from '../repositories/accountRepository.js';
import { WorkspaceRepository } from '../repositories/workspaceRepository.js';

const adminUrl = process.env.TEAMMGR_TEST_ADMIN_DATABASE_URL;

test('席位角色迁移按活动成员、邀请和 Account 邮箱回填，未知与 owner 保持空', { skip: !adminUrl }, async () => {
  const name = `team_manager_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  const url = new URL(adminUrl!); url.pathname = `/${name}`;
  try {
    await admin.query(`create database "${name}"`);
    const db = createDatabase({ connectionString: url.toString() });
    try {
      const migrated = await createMigrator(db).migrateTo('026_account_residential_proxy');
      if (migrated.error) throw migrated.error;
      const workspaces = new WorkspaceRepository(db);
      const workspace = await workspaces.upsert({ externalId: 'role-migration' });
      const other = await workspaces.upsert({ externalId: 'other-role-migration' });
      const account = (await new AccountRepository(db).create({ email: 'fallback@example.com' })).account;
      await workspaces.upsertMembership({ workspaceId: workspace.id, accountId: account.id, rawRole: 'account-admin', normalizedRole: 'admin', observedAt: new Date(), source: 'test' });
      for (const [email, role, status] of [
        ['member@example.com', 'analytics-viewer', 'active'],
        ['owner@example.com', 'account-owner', 'active'],
        ['unknown@example.com', 'future-role', 'active'],
        ['removed@example.com', 'account-admin', 'removed'],
      ]) {
        await workspaces.upsertMembership({ workspaceId: workspace.id, email, rawRole: role, normalizedRole: 'member', status: status as 'active' | 'removed', observedAt: new Date(), source: 'test' });
      }
      await workspaces.upsertMembership({ workspaceId: other.id, email: 'unmatched@example.com', rawRole: 'account-admin', normalizedRole: 'admin', observedAt: new Date(), source: 'test' });
      for (const [email, role, status] of [
        ['invite@example.com', 'standard-user', 'pending'],
        ['member@example.com', 'account-admin', 'pending'],
        ['revoked@example.com', 'standard-user', 'revoked'],
      ]) {
        await db.insertInto('workspace_invitations').values({ workspace_id: workspace.id, email, normalized_email: email, raw_role: role, normalized_role: 'member', status, observed_at: new Date(), account_id: null, remote_invitation_id: null, seat_type: null, invited_at: null }).execute();
      }
      const expected: Record<string, string | null> = {
        'member@example.com': 'analytics-viewer', 'owner@example.com': null,
        'unknown@example.com': null, 'removed@example.com': null,
        'invite@example.com': 'standard-user', 'revoked@example.com': null,
        'fallback@example.com': 'account-admin', 'unmatched@example.com': null,
      };
      for (const email of Object.keys(expected)) {
        // This fixture intentionally inserts the pre-migration schema without role.
        await db.insertInto('seat_slots').values({ workspace_id: workspace.id, seat_key: randomUUID(), current_email: email, normalized_current_email: email } as any).execute();
      }
      await migrateToLatest(db);
      const rows = await db.selectFrom('seat_slots').select(['current_email', 'role']).where('workspace_id', '=', workspace.id).execute();
      for (const row of rows) assert.equal(row.role, expected[row.current_email!], row.current_email!);
      await assert.rejects(db.updateTable('seat_slots').set({ role: 'account-owner' }).where('workspace_id', '=', workspace.id).execute(), /seat_slots_role_check/);
    } finally { await db.destroy(); await new Promise((resolve) => setTimeout(resolve, 100)); }
  } finally {
    await admin.query(`drop database if exists "${name}" `);
    await admin.end();
  }
});
