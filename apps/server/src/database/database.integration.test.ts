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
import { ArtifactStore } from '../artifactStore.js';
import { ArtifactService } from '../services/artifactService.js';
import { ArtifactIndexRepository } from '../repositories/artifactIndexRepository.js';
import { SeatSlotService } from '../services/seatSlotService.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TeamOrderService } from '../services/teamOrderService.js';

const adminUrl = process.env.TEAMMGR_TEST_ADMIN_DATABASE_URL;

test('统一账号 PostgreSQL 模型与 API', { skip: !adminUrl, timeout: 60_000 }, async () => {
  const databaseName = `team_manager_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  const databaseUrl = databaseUrlFor(adminUrl!, databaseName);
  try {
    await admin.query(`create database ${quoteIdentifier(databaseName)}`);
    const db = createDatabase({ connectionString: databaseUrl, applicationName: 'team-manager-unified-test' });
    try {
      assert.deepEqual(await migrateToLatest(db), ['001_initial_unified_model', '002_complete_operational_fields', '003_add_quarantined_artifacts', '004_complete_product_runtime']);
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
          syncAccount: async () => ({ id: first.account.email, email: first.account.email, personalPlan: 'free',
            personalSubscription: { planType: 'free', willRenew: false },
            paymentMethods: [], workspaces: [{ id: workspace.external_id, name: workspace.name ?? undefined, planType: 'business', role: 'account-owner', seatType: 'default' }] }),
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

      const sessionResponse = await app.request(`/api/accounts/${first.account.id}/session`, { headers });
      assert.equal(sessionResponse.status, 200);
      assert.equal((await sessionResponse.json() as any).data.accessToken, 'secret');
      const syncResponse = await app.request(`/api/accounts/${first.account.id}/sync`, { method: 'POST', headers });
      assert.equal(syncResponse.status, 200);
      assert.equal((await db.selectFrom('personal_subscription_snapshots').selectAll().where('personal_space_id', '=', first.personalSpace.id).execute()).length, 1);

      const personal = await app.request(`/api/accounts/${first.account.id}/personal-subscription`, { method: 'POST', headers, body: JSON.stringify({ targetPlan: 'plus', mode: 'start_new', country: 'US', currency: 'USD', autoPay: true, card: { number: '4242424242424242', expiryMonth: 12, expiryYear: 2030, cvc: '123' } }) });
      assert.equal(personal.status, 200, await personal.clone().text());
      const stored = await db.selectFrom('automation_operations').selectAll().where('external_operation_id', '=', 'personal-operation').executeTakeFirstOrThrow();
      assert.equal(JSON.stringify(stored).includes('4242424242424242'), false);
      assert.equal(JSON.stringify(stored).includes('123'), false);

      const blocked = await app.request(`/api/accounts/${first.account.id}/personal-subscription`, { method: 'POST', headers, body: JSON.stringify({ targetPlan: 'pro_20x', mode: 'change_existing', country: 'US', currency: 'USD', autoPay: false }) });
      assert.equal(blocked.status, 409);
      const business = await app.request(`/api/accounts/${first.account.id}/business-subscription`, { method: 'POST', headers, body: JSON.stringify({ mode: 'upgrade_existing_workspace', workspaceId: workspace.id, country: 'US', currency: 'USD', autoPay: false }) });
      assert.equal(business.status, 200);

      const operationRow = await db.selectFrom('automation_operations').select('id').where('external_operation_id', '=', 'business-operation').executeTakeFirstOrThrow();
      assert.equal((await app.request(`/api/operations/${operationRow.id}`, { headers })).status, 200);
      assert.ok((await db.selectFrom('automation_operation_events').selectAll().where('operation_id', '=', operationRow.id).execute()).length > 0);

      const slot = await app.request(`/api/workspaces/${workspace.id}/seat-slots`, { method: 'POST', headers, body: JSON.stringify({ email: 'customer@example.com', seatType: 'usage_based', contact: 'contact', expiresOn: '2030-01-01' }) });
      assert.equal(slot.status, 200);
      const slotId = (await slot.json() as any).data.id;
      assert.equal((await app.request(`/api/workspaces/${workspace.id}/seat-slots/${slotId}`, { method: 'PATCH', headers, body: JSON.stringify({ remark: 'paid' }) })).status, 200);
      await db.updateTable('seat_slots').set({ expires_on: '2020-01-01', status: 'invited', expire_remove: false }).where('id', '=', slotId).execute();
      const expirationService = new SeatSlotService(db, {} as any, {} as any);
      assert.equal((await expirationService.runExpirations(new Date('2026-01-01T00:00:00Z'))).disabled, 1);
      assert.equal((await expirationService.runExpirations(new Date('2026-01-01T00:01:00Z'))).disabled, 0);

      assert.equal((await app.request('/api/credential-pool-groups', { method: 'POST', headers, body: JSON.stringify({ name: 'pool-a' }) })).status, 200);
      assert.equal((await app.request('/api/overview/workspaces', { headers })).status, 200);
      assert.equal((await app.request('/api/settings/system/form-preferences', { method: 'PUT', headers, body: JSON.stringify({ country: 'US' }) })).status, 200);

      await db.insertInto('team_order_maintenances').values({workspace_id:workspace.id,executor_account_id:first.account.id,enabled:true,last_run_at:null,promo_code:null,country:'US',currency:'USD',next_run_at:new Date(),pause_reason:null,last_success_at:null,last_error:null}).execute();
      await db.insertInto('team_upgrade_orders').values({workspace_id:workspace.id,executor_account_id:first.account.id,external_order_id:null,checkout_url:null,expires_at:null,status:'running',configuration_snapshot:{country:'US',currency:'USD'},source:'manual',scheduled_for:new Date(),task_id:null,stripe_created_at:null,retry_at:null,attempt_count:1,error_message:null,completed_at:null}).execute();
      const orderService=new TeamOrderService(db,sessions,{} as any,{configured:false,generateOrder:async()=>{throw new Error('unused');}});await orderService.recover();
      assert.equal((await db.selectFrom('team_upgrade_orders').select('status').where('workspace_id','=',workspace.id).executeTakeFirstOrThrow()).status,'queued');

      const artifactRoot=await mkdtemp(join(tmpdir(),'team-manager-artifacts-'));const artifactStore=new ArtifactStore(artifactRoot);const artifactIndexes=new ArtifactIndexRepository(db,artifactStore);
      const artifactId=await artifactIndexes.save('rrweb',{fileName:'recording.json.gz',content:Buffer.from('raw-rrweb'),recordedAt:new Date('2020-01-01')});
      const artifactService=new ArtifactService(db,artifactStore,artifactRoot);await artifactService.markDelete('rrweb',artifactId,1);
      assert.equal((await artifactService.cleanup(new Date(Date.now()+1000))).removed,1);
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
