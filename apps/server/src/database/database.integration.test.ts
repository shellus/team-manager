import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { createDatabase } from './connection.js';
import { migrateToLatest, pendingMigrations } from './migrator.js';
import { AccountRepository } from '../repositories/accountRepository.js';
import { WorkspaceRepository } from '../repositories/workspaceRepository.js';
import { SessionRepository } from '../repositories/sessionRepository.js';
import { SecretCipher } from '../secretCipher.js';
import { buildUnifiedApp } from '../unifiedApp.js';

const adminUrl = process.env.TEAMMGR_TEST_ADMIN_DATABASE_URL;

test('统一账号 PostgreSQL 模型与 API', { skip: !adminUrl, timeout: 60_000 }, async () => {
  const databaseName = `team_manager_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  const databaseUrl = databaseUrlFor(adminUrl!, databaseName);
  try {
    await admin.query(`create database ${quoteIdentifier(databaseName)}`);
    const db = createDatabase({ connectionString: databaseUrl, applicationName: 'team-manager-unified-test' });
    try {
      assert.deepEqual(await migrateToLatest(db), ['001_initial_unified_model', '002_complete_operational_fields', '003_add_quarantined_artifacts']);
      assert.deepEqual(await migrateToLatest(db), []);
      assert.deepEqual(await pendingMigrations(db), []);

      const accounts = new AccountRepository(db);
      const workspaces = new WorkspaceRepository(db);
      const group = await accounts.createGroup('Operators');
      const first = await accounts.create({ email: 'owner@example.com', groupId: group.id });
      const second = await accounts.create({ email: 'member@example.com', groupId: group.id });
      await assert.rejects(accounts.create({ email: 'OWNER@example.com', groupId: group.id }), /duplicate key/i);
      const workspace = await workspaces.upsert({ externalId: 'workspace-external', name: 'Business', normalizedPlan: 'business' });
      await workspaces.upsertMembership({ workspaceId: workspace.id, accountId: first.account.id, email: first.account.email, normalizedRole: 'owner', seatType: 'default', observedAt: new Date(), source: 'test' });
      await workspaces.upsertMembership({ workspaceId: workspace.id, accountId: second.account.id, email: second.account.email, normalizedRole: 'member', seatType: 'usage_based', observedAt: new Date(), source: 'test' });
      assert.deepEqual((await accounts.list({ hasManageableWorkspace: true })).map((item) => item.email), ['owner@example.com']);
      assert.deepEqual((await accounts.list({ isWorkspaceMember: true })).map((item) => item.email), ['member@example.com']);

      const sessions = new SessionRepository(db, new SecretCipher('0'.repeat(64), 'test-v1'));
      await sessions.saveRevision({ accountId: first.account.id, session: { user: { email: first.account.email }, account: { id: 'personal' }, accessToken: 'secret' }, source: 'test' });
      assert.equal((await sessions.currentSession(first.account.id) as any).accessToken, 'secret');
      await accounts.bindGamAccount(first.account.id, first.account.email);

      const app = await buildUnifiedApp({
        database: db,
        config: { port: 0, dataDir: '/tmp', artifactDir: '/tmp', databaseUrl, dataEncryptionKey: '0'.repeat(64), dataEncryptionKeyVersion: 'test-v1', jwtSecret: 'secret', jwtIssuer: 'team-manager', adminUsername: 'admin', adminPassword: 'password', apiToken: 'test-token', allowedOrigins: [], webDistDir: '/missing' },
        accountManager: {
          operation: async (id) => operation(id),
          changePersonalSubscription: async () => operation('personal-operation'),
          cancelPersonalSubscriptionRenewal: async () => operation('cancel-operation'),
          openBusinessSubscription: async (_account, input) => operation('business-operation', { workspaceId: input.workspaceId })
        }
      });
      const headers = { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' };
      assert.equal((await app.request('/health')).status, 200);
      assert.equal((await app.request('/api/accounts?hasManageableWorkspace=true', { headers })).status, 200);
      assert.equal((await app.request('/api/parents', { headers })).status, 404);
      assert.equal((await app.request('/api/subaccounts', { headers })).status, 404);
      assert.equal((await app.request('/api/not-a-real-endpoint', { headers })).status, 404);

      const personal = await app.request(`/api/accounts/${first.account.id}/personal-subscription`, { method: 'POST', headers, body: JSON.stringify({ targetPlan: 'plus', mode: 'start_new', country: 'US', currency: 'USD', autoPay: true, card: { number: '4242424242424242', expiryMonth: 12, expiryYear: 2030, cvc: '123' } }) });
      assert.equal(personal.status, 200);
      const stored = await db.selectFrom('automation_operations').selectAll().where('external_operation_id', '=', 'personal-operation').executeTakeFirstOrThrow();
      assert.equal(JSON.stringify(stored).includes('4242424242424242'), false);
      assert.equal(JSON.stringify(stored).includes('123'), false);

      const blocked = await app.request(`/api/accounts/${first.account.id}/personal-subscription`, { method: 'POST', headers, body: JSON.stringify({ targetPlan: 'pro_20x', mode: 'change_existing', country: 'US', currency: 'USD', autoPay: false }) });
      assert.equal(blocked.status, 409);
      const business = await app.request(`/api/accounts/${first.account.id}/business-subscription`, { method: 'POST', headers, body: JSON.stringify({ mode: 'upgrade_existing_workspace', workspaceId: workspace.id, country: 'US', currency: 'USD', autoPay: false }) });
      assert.equal(business.status, 200);
    } finally { await db.destroy(); }
  } finally {
    await admin.query(`drop database if exists ${quoteIdentifier(databaseName)} with (force)`).catch(() => undefined);
    await admin.end();
  }
});

function operation(id: string, requestSummary: Record<string, unknown> = {}) {
  return { id, type: id, status: 'queued' as const, phase: 'queued', progress: 0, requestSummary, createdAt: 1, updatedAt: 1 };
}
function databaseUrlFor(source: string, databaseName: string): string { const parsed = new URL(source); parsed.pathname = `/${databaseName}`; return parsed.toString(); }
function quoteIdentifier(value: string): string { return `"${value.replaceAll('"', '""')}"`; }
