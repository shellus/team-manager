import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table seat_slots drop column expire_reminder`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table seat_slots add column expire_reminder boolean not null default false`.execute(db);
}
