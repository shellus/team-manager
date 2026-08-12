import { Kysely, PostgresDialect } from 'kysely';
import { Pool, type PoolConfig } from 'pg';
import type { Database } from './schema.js';

export interface DatabaseConnectionOptions {
  connectionString: string;
  maxConnections?: number;
  applicationName?: string;
}

export function createDatabase(options: DatabaseConnectionOptions): Kysely<Database> {
  const poolConfig: PoolConfig = {
    connectionString: options.connectionString,
    max: options.maxConnections ?? 10,
    application_name: options.applicationName ?? 'team-manager',
    statement_timeout: 30_000,
    idle_in_transaction_session_timeout: 30_000
  };
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool(poolConfig) }) });
}

export async function databaseHealth(db: Kysely<Database>): Promise<void> {
  await db.selectNoFrom((eb) => eb.lit(1).as('ok')).executeTakeFirstOrThrow();
}
