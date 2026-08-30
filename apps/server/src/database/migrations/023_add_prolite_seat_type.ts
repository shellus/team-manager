import type { Kysely } from 'kysely';
import type { Database } from '../schema.js';
import { sql } from 'kysely';

const TABLES = ['workspace_memberships', 'workspace_invitations', 'seat_slots'] as const;

export async function up(db: Kysely<Database>): Promise<void> {
  for (const table of TABLES) {
    await sql.raw(`alter table ${table} drop constraint if exists ${table}_seat_type_check`).execute(db);
    await sql.raw(`alter table ${table} add constraint ${table}_seat_type_check check (seat_type in ('default', 'usage_based', 'prolite'))`).execute(db);
  }
}

export async function down(db: Kysely<Database>): Promise<void> {
  for (const table of TABLES) {
    await sql.raw(`alter table ${table} drop constraint if exists ${table}_seat_type_check`).execute(db);
    await sql.raw(`alter table ${table} add constraint ${table}_seat_type_check check (seat_type in ('default', 'usage_based'))`).execute(db);
  }
}
