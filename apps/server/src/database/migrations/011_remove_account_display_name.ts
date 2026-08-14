import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table accounts drop column display_name`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table accounts add column display_name text`.execute(db);
}
