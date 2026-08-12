import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Kysely, Migrator, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { createDatabase } from './connection.js';
import { createMigrator, migrateToLatest, pendingMigrations } from './migrator.js';
import { AccountRepository } from '../repositories/accountRepository.js';
import { WorkspaceRepository } from '../repositories/workspaceRepository.js';
import { SessionRepository } from '../repositories/sessionRepository.js';
import { CredentialRepository } from '../repositories/credentialRepository.js';
import { SeatSlotRepository } from '../repositories/seatSlotRepository.js';
import { SettingsRepository } from '../repositories/settingsRepository.js';
import { BillingRepository } from '../repositories/billingRepository.js';
import { TeamOrderRepository } from '../repositories/teamOrderRepository.js';
import { ArtifactIndexRepository } from '../repositories/artifactIndexRepository.js';
import { SecretCipher } from '../secretCipher.js';
import { ArtifactStore } from '../artifactStore.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildUnifiedApp } from '../unifiedApp.js';

const adminUrl = process.env.TEAMMGR_TEST_ADMIN_DATABASE_URL;

test('PostgreSQL migrations and unified model constraints', { skip: !adminUrl, timeout: 60_000 }, async () => {
  const databaseName = `team_manager_test_${randomUUID().replaceAll('-', '')}`;
  const adminPool = new Pool({ connectionString: adminUrl, max: 1 });
  const databaseUrl = databaseUrlFor(adminUrl!, databaseName);
  try {
    await adminPool.query(`create database ${quoteIdentifier(databaseName)}`);
    const first = createDatabase({ connectionString: databaseUrl, applicationName: 'team-manager-test-first' });
    const second = createDatabase({ connectionString: databaseUrl, applicationName: 'team-manager-test-second' });
    try {
      const [firstResult, secondResult] = await Promise.all([migrateToLatest(first), migrateToLatest(second)]);
      assert.deepEqual([...firstResult, ...secondResult].sort(), [
        '001_initial_unified_model',
        '002_complete_operational_fields',
        '003_add_quarantined_artifacts'
      ]);
      assert.deepEqual(await pendingMigrations(first), []);
      assert.deepEqual(await migrateToLatest(first), []);

      const defaultGroup = await first.selectFrom('account_groups').selectAll().where('is_default', '=', true).executeTakeFirstOrThrow();
      const inserted = await first.insertInto('accounts').values({
        group_id: defaultGroup.id,
        email: 'owner@example.com',
        normalized_email: 'owner@example.com',
        remark: null,
        remote_user_id: null,
        display_name: null,
        last_error: null
      }).returning('id').executeTakeFirstOrThrow();
      const personalSpace = await first.insertInto('personal_spaces').values({
        account_id: inserted.id,
        remote_account_id: 'personal-account-id'
      }).returning('id').executeTakeFirstOrThrow();
      const workspace = await first.insertInto('workspaces').values({
        external_id: 'workspace-id',
        name: 'Workspace',
        raw_plan_code: null,
        next_renewal_at: null
      }).returning('id').executeTakeFirstOrThrow();

      await assert.rejects(first.insertInto('accounts').values({
        group_id: defaultGroup.id,
        email: 'owner@example.com',
        normalized_email: 'owner@example.com',
        remark: null,
        remote_user_id: null,
        display_name: null,
        last_error: null
      }).execute(), /duplicate key/i);

      await assert.rejects(first.insertInto('account_access_contexts').values({
        account_id: inserted.id,
        personal_space_id: personalSpace.id,
        workspace_id: workspace.id,
        ciphertext: 'ciphertext',
        nonce: 'nonce',
        auth_tag: 'tag',
        key_version: 'v1',
        expires_at: null,
        checked_at: null
      }).execute(), /account_access_contexts_check/i);

      await first.insertInto('workspace_memberships').values({
        workspace_id: workspace.id,
        account_id: null,
        remote_user_id: 'remote-only-user',
        email: 'remote@example.com',
        normalized_email: 'remote@example.com',
        display_name: null,
        raw_role: 'standard-user',
        normalized_role: 'member',
        seat_type: 'usage_based',
        joined_at: null,
        observed_at: new Date(),
        source: 'test'
      }).execute();

      await assert.rejects(first.transaction().execute(async (trx) => {
        await trx.insertInto('account_groups').values({
          name: 'Rollback Group',
          normalized_name: 'rollback group'
        }).execute();
        throw new Error('rollback-test');
      }), /rollback-test/);
      assert.equal(await first.selectFrom('account_groups').select(({ fn }) => fn.countAll<number>().as('count')).where('normalized_name', '=', 'rollback group').executeTakeFirstOrThrow().then((row) => Number(row.count)), 0);

      await verifyFailedMigrationRollsBack(databaseUrl);
      await verifyRepositories(first);
      await verifyUnifiedApi(first);
    } finally {
      await Promise.all([first.destroy(), second.destroy()]);
    }
  } finally {
    await adminPool.query(`drop database if exists ${quoteIdentifier(databaseName)} with (force)`).catch(() => undefined);
    await adminPool.end();
  }
});

async function verifyRepositories(db: ReturnType<typeof createDatabase>): Promise<void> {
  const accounts = new AccountRepository(db);
  const workspaces = new WorkspaceRepository(db);
  const group = await accounts.createGroup('Operators');
  const renamed = await accounts.renameGroup(group.id, 'Primary Operators');
  assert.equal(renamed.name, 'Primary Operators');
  const created = await accounts.create({ email: 'manager@example.com', groupId: group.id });
  const workspace = await workspaces.upsert({ externalId: 'managed-workspace', name: 'Managed', normalizedPlan: 'business' });
  await workspaces.upsertMembership({
    workspaceId: workspace.id,
    accountId: created.account.id,
    email: created.account.email,
    normalizedRole: 'owner',
    seatType: 'default',
    observedAt: new Date(),
    source: 'integration-test'
  });
  await workspaces.upsertMembership({
    workspaceId: workspace.id,
    remoteUserId: 'remote-two',
    email: 'remote-two@example.com',
    normalizedRole: 'member',
    seatType: 'usage_based',
    observedAt: new Date(),
    source: 'integration-test'
  });
  const manageable = await accounts.list({ hasManageableWorkspace: true });
  assert.equal(manageable.some((item) => item.id === created.account.id), true);
  assert.equal((await workspaces.listForAccount(created.account.id))[0]?.external_id, 'managed-workspace');

  const sessions = new SessionRepository(db, new SecretCipher('0'.repeat(64), 'test-v1'));
  await sessions.saveRevision({
    accountId: created.account.id,
    session: { accessToken: 'session-secret', user: { email: created.account.email } },
    source: 'integration-test'
  });
  assert.deepEqual(await sessions.currentSession(created.account.id), {
    accessToken: 'session-secret',
    user: { email: created.account.email }
  });
  await sessions.saveAccessToken(created.account.id, { kind: 'personal', personalSpaceId: created.personalSpace.id }, 'personal-token');
  await sessions.saveAccessToken(created.account.id, { kind: 'workspace', workspaceId: workspace.id }, 'workspace-token');
  assert.equal(await sessions.accessToken(created.account.id, { kind: 'personal', personalSpaceId: created.personalSpace.id }), 'personal-token');
  assert.equal(await sessions.accessToken(created.account.id, { kind: 'workspace', workspaceId: workspace.id }), 'workspace-token');

  const artifactDirectory = await mkdtemp(join(tmpdir(), 'team-manager-repository-artifacts-'));
  try {
    const artifactStore = new ArtifactStore(artifactDirectory);
    const credentials = new CredentialRepository(db, artifactStore);
    const credential = await credentials.save({
      accountId: created.account.id,
      workspaceId: workspace.id,
      kind: 'pat',
      fileName: 'credential.json',
      content: Buffer.from('{"access_token":"secret"}')
    });
    assert.equal((await credentials.read(credential.id)).toString(), '{"access_token":"secret"}');

    const indexes = new ArtifactIndexRepository(db, artifactStore);
    const traceId = await indexes.save('traces', {
      fileName: 'trace.jsonl', content: Buffer.from('{"request":"safe"}\n'), recordedAt: new Date()
    });
    assert.equal((await indexes.read('traces', traceId)).toString(), '{"request":"safe"}\n');
    const rrwebId = await indexes.save('rrweb', {
      fileName: 'recording.json.gz', content: Buffer.from('compressed-recording'), recordedAt: new Date()
    });
    assert.equal((await indexes.read('rrweb', rrwebId)).toString(), 'compressed-recording');
    await indexes.quarantineCredential({
      fileName: 'unassigned.json', content: Buffer.from('{"credential":"unassigned"}'),
      reasonCode: 'ACCOUNT_NOT_FOUND', metadata: { workspaceEvidence: true }
    });
    assert.equal(Number((await db.selectFrom('quarantined_artifacts').select(({ fn }) => fn.countAll<number>().as('count')).executeTakeFirstOrThrow()).count), 1);
  } finally {
    await rm(artifactDirectory, { recursive: true, force: true });
  }

  const seatSlots = new SeatSlotRepository(db);
  const seat = await seatSlots.save({
    workspaceId: workspace.id,
    seatKey: '1234567890abcdef',
    email: 'customer@example.com',
    expiresOn: '2026-12-31',
    seatType: 'default',
    status: 'member'
  });
  assert.equal((await seatSlots.findByPublicKey(seat.seat_key))?.current_email, 'customer@example.com');

  const settings = new SettingsRepository(db, new SecretCipher('0'.repeat(64), 'test-v1'));
  await settings.setValue('task-form-preferences', { registration: { country: 'US' } });
  assert.deepEqual(await settings.value('task-form-preferences'), { registration: { country: 'US' } });
  await settings.setSecret('notification.telegram', JSON.stringify({ botToken: 'secret-token', chatId: '42' }));
  assert.equal(await settings.secret('notification.telegram'), JSON.stringify({ botToken: 'secret-token', chatId: '42' }));
  const secretRow = await db.selectFrom('system_settings').selectAll().where('key', '=', 'notification.telegram').executeTakeFirstOrThrow();
  assert.equal(JSON.stringify(secretRow.value).includes('secret-token'), false);
  assert.equal(secretRow.ciphertext?.includes('secret-token'), false);

  const billing = new BillingRepository(db);
  await billing.saveSnapshot({ kind: 'workspace', workspaceId: workspace.id }, { invoices: [] }, new Date());
  assert.deepEqual((await billing.latest({ kind: 'workspace', workspaceId: workspace.id }))?.payload, { invoices: [] });

  const teamOrders = new TeamOrderRepository(db);
  await teamOrders.saveConfiguration(null, { promoCode: 'PROMO', country: 'us', currency: 'usd' });
  await teamOrders.saveMaintenance({
    workspaceId: workspace.id, executorAccountId: created.account.id, enabled: true,
    overrides: { country: 'gb' }, nextRunAt: new Date(), lastSuccessAt: new Date()
  });
  await teamOrders.saveOrder({
    workspaceId: workspace.id, executorAccountId: created.account.id,
    status: 'queued', configuration: { country: 'US' }, source: 'manual', attemptCount: 1
  });
  assert.equal((await db.selectFrom('team_order_configurations').select('country').where('workspace_id', 'is', null).executeTakeFirstOrThrow()).country, 'US');
  assert.equal((await db.selectFrom('team_order_maintenances').select('country').where('workspace_id', '=', workspace.id).executeTakeFirstOrThrow()).country, 'GB');
  await assert.rejects(accounts.deleteGroup(group.id), /非空/);
  await accounts.moveToGroup(created.account.id, (await accounts.defaultGroup()).id);
  await accounts.deleteGroup(group.id);
}

async function verifyUnifiedApi(db: ReturnType<typeof createDatabase>): Promise<void> {
  const upstreamRequests: Array<{ path: string; accountHeader?: string }> = [];
  let businessTargetWorkspaceId = '';
  const app = await buildUnifiedApp({
    database: db,
    config: {
      port: 0, dataDir: '/tmp', artifactDir: '/tmp', databaseUrl: 'unused',
      dataEncryptionKey: '0'.repeat(64), dataEncryptionKeyVersion: 'test-v1',
      jwtSecret: 'integration-test-secret', jwtIssuer: 'team-manager',
      adminUsername: 'admin', adminPassword: 'password', apiToken: 'integration-token',
      allowedOrigins: [], webDistDir: '/tmp'
    },
    transport: {
      async fetch(request) {
        upstreamRequests.push({ path: request.path, accountHeader: request.headers['chatgpt-account-id'] });
        if (request.path.includes('/users?')) return { status: 200, body: JSON.stringify({ items: [] }) };
        throw new Error(`unexpected upstream ${request.path}`);
      }
    },
    accountManager: {
      changePersonalSubscription: async (_accountId: string, input: any) => ({
        id: 'gam-personal-operation', type: 'change_personal_subscription', status: 'queued',
        phase: 'personal_subscription_queued', progress: 0,
        requestSummary: { targetPlan: input.targetPlan, cardLast4: input.card?.number.slice(-4) },
        createdAt: 1, updatedAt: 1
      }),
      cancelPersonalSubscriptionRenewal: async () => ({
        id: 'gam-cancel-operation', type: 'cancel_personal_subscription_renewal', status: 'queued',
        phase: 'queued', progress: 0, createdAt: 1, updatedAt: 1
      }),
      openBusinessSubscription: async (_accountId: string, input: any) => {
        businessTargetWorkspaceId = input.workspaceId;
        return ({
        id: 'gam-business-operation', type: 'open_business_subscription', status: 'queued',
        phase: 'queued', progress: 0, requestSummary: { workspaceId: input.workspaceId },
        createdAt: 1, updatedAt: 1
      }); }
    } as any
  });
  const auth = { Authorization: 'Bearer integration-token', 'Content-Type': 'application/json' };
  const groupsResponse = await app.request('/api/account-groups', { headers: auth });
  assert.equal(groupsResponse.status, 200);
  const groups = (await groupsResponse.json() as any).data;
  assert.equal(groups.some((group: any) => group.name === '默认分组'), true);

  const createdResponse = await app.request('/api/accounts', {
    method: 'POST', headers: auth,
    body: JSON.stringify({
      email: 'unified-api@example.com', remark: '统一账号',
      session: { user: { email: 'unified-api@example.com' }, account: { id: 'personal-unified' }, accessToken: 'secret-web-token' }
    })
  });
  assert.equal(createdResponse.status, 200);
  const created = (await createdResponse.json() as any).data;
  assert.equal(created.email, 'unified-api@example.com');
  assert.equal(created.hasSession, true);
  assert.equal(created.personalSpace.remoteAccountId, 'personal-unified');
  await db.insertInto('gam_bindings').values({
    account_id: created.id,
    external_account_ref: 'unified-api@example.com',
    normalized_external_account_ref: 'unified-api@example.com'
  }).execute();

  const listResponse = await app.request('/api/accounts?hasSession=true&hasManageableWorkspace=false', { headers: auth });
  assert.equal(listResponse.status, 200);
  const listed = (await listResponse.json() as any).data;
  assert.equal(listed.some((item: any) => item.id === created.id), true);

  const personal = await app.request(`/api/accounts/${created.id}/personal-subscription`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ targetPlan: 'plus', mode: 'start_new', country: 'US', currency: 'USD', autoPay: true,
      card: { number: '4242424242424242', expiryMonth: 12, expiryYear: 2030, cvc: '123' } })
  });
  assert.equal(personal.status, 200);
  const storedPersonal = await db.selectFrom('automation_operations').selectAll()
    .where('external_operation_id', '=', 'gam-personal-operation').executeTakeFirstOrThrow();
  assert.equal(JSON.stringify(storedPersonal).includes('4242424242424242'), false);
  assert.equal(JSON.stringify(storedPersonal).includes('"cvc"'), false);
  assert.equal((storedPersonal.safe_request_summary as any).cardLast4, '4242');

  const blockedChange = await app.request(`/api/accounts/${created.id}/personal-subscription`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ targetPlan: 'pro_20x', mode: 'change_existing', country: 'US', currency: 'USD', autoPay: false })
  });
  assert.equal(blockedChange.status, 409);

  const workspace = await db.selectFrom('workspaces').selectAll().where('external_id', '=', 'managed-workspace').executeTakeFirstOrThrow();
  const denied = await app.request(`/api/workspaces/${workspace.id}/members/refresh`, {
    method: 'POST', headers: auth, body: JSON.stringify({ executorAccountId: created.id })
  });
  assert.equal(denied.status, 409);
  assert.equal(upstreamRequests.length, 0);

  const executor = await db.selectFrom('accounts').select('id').where('normalized_email', '=', 'manager@example.com').executeTakeFirstOrThrow();
  await db.insertInto('gam_bindings').values({
    account_id: executor.id,
    external_account_ref: 'manager@example.com',
    normalized_external_account_ref: 'manager@example.com'
  }).execute();
  const workspaceContext = new SessionRepository(db, new SecretCipher('0'.repeat(64), 'test-v1'));
  await workspaceContext.saveAccessToken(executor.id, { kind: 'workspace', workspaceId: workspace.id }, 'workspace-api-token');
  const refreshed = await app.request(`/api/workspaces/${workspace.id}/members/refresh`, {
    method: 'POST', headers: auth, body: JSON.stringify({ executorAccountId: executor.id })
  });
  assert.equal(refreshed.status, 200);
  assert.equal(upstreamRequests.length, 1);
  assert.equal(upstreamRequests[0]?.accountHeader, 'managed-workspace');
  await new WorkspaceRepository(db).upsertMembership({
    workspaceId: workspace.id, accountId: executor.id, email: 'manager@example.com',
    normalizedRole: 'owner', seatType: 'default', observedAt: new Date(), source: 'integration-test'
  });

  const business = await app.request(`/api/accounts/${executor.id}/business-subscription`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ mode: 'upgrade_existing_workspace', workspaceId: workspace.id, country: 'US', currency: 'USD', autoPay: false })
  });
  assert.equal(business.status, 200, JSON.stringify(await business.clone().json().catch(() => ({}))));
  assert.equal(businessTargetWorkspaceId, workspace.external_id);

  assert.equal((await app.request('/api/subaccounts', { headers: auth })).status, 404);
  assert.equal((await app.request(`/api/accounts/${created.id}/members`, { headers: auth })).status, 404);
}

async function verifyFailedMigrationRollsBack(connectionString: string): Promise<void> {
  const db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString, max: 1 }) }) });
  try {
    const migrator = new Migrator({
      db,
      migrationTableName: 'failure_migration',
      migrationLockTableName: 'failure_migration_lock',
      provider: {
        async getMigrations() {
          return {
            intentional_failure: {
              async up(migrationDb) {
                await sql`create table must_rollback (id integer primary key)`.execute(migrationDb);
                throw new Error('intentional-migration-failure');
              }
            }
          };
        }
      }
    });
    const result = await migrator.migrateToLatest();
    assert.match(String(result.error), /intentional-migration-failure/);
    const table = await sql<{ name: string | null }>`select to_regclass('public.must_rollback')::text as name`.execute(db);
    assert.equal(table.rows[0]?.name, null);
  } finally {
    await db.destroy();
  }
}

function databaseUrlFor(source: string, databaseName: string): string {
  const parsed = new URL(source);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
