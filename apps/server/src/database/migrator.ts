import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileMigrationProvider, type Kysely, Migrator } from 'kysely';
import type { Database } from './schema.js';

const migrationFolder = fileURLToPath(new URL('./migrations', import.meta.url));

export function createMigrator(db: Kysely<Database>): Migrator {
  return new Migrator({
    db,
    provider: new FileMigrationProvider({ fs, path, migrationFolder })
  });
}

export async function migrateToLatest(db: Kysely<Database>): Promise<string[]> {
  const { error, results } = await createMigrator(db).migrateToLatest();
  if (error) throw error;
  return (results ?? []).filter((result) => result.status === 'Success').map((result) => result.migrationName);
}

export async function pendingMigrations(db: Kysely<Database>): Promise<string[]> {
  const migrations = await createMigrator(db).getMigrations();
  return migrations.filter((migration) => !migration.executedAt).map((migration) => migration.name);
}

export async function assertMigrationsCurrent(db: Kysely<Database>): Promise<void> {
  const pending = await pendingMigrations(db);
  if (pending.length > 0) throw new Error(`数据库存在未应用 migration：${pending.join(', ')}；请先运行 db:migrate`);
}
