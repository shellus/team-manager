import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`alter table team_order_configurations add column if not exists seat_quantities jsonb`.execute(db);
  await sql`alter table team_order_maintenances add column if not exists seat_quantities jsonb`.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`alter table team_order_configurations drop column if exists seat_quantities`.execute(db);
  await sql`alter table team_order_maintenances drop column if exists seat_quantities`.execute(db);
}
