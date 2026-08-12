import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Kysely, Migrator, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { createDatabase } from './connection.js';
import { createMigrator, migrateToLatest, pendingMigrations } from './migrator.js';

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
      assert.deepEqual([...firstResult, ...secondResult], ['001_initial_unified_model']);
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
    } finally {
      await Promise.all([first.destroy(), second.destroy()]);
    }
  } finally {
    await adminPool.query(`drop database if exists ${quoteIdentifier(databaseName)} with (force)`).catch(() => undefined);
    await adminPool.end();
  }
});

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
