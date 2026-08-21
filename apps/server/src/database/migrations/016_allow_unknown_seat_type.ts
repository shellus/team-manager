import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table seat_slots alter column seat_type drop not null`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table seat_slots alter column seat_type set not null`.execute(db);
}
