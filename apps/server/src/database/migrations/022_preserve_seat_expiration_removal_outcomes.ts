import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table seat_expiration_removal_attempts
      drop constraint if exists seat_expiration_removal_attempts_status_check,
      add column succeeded_at timestamptz,
      add constraint seat_expiration_removal_attempts_status_check
        check (status in ('retrying', 'running', 'failed', 'succeeded'));
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    delete from seat_expiration_removal_attempts where status = 'succeeded';
    alter table seat_expiration_removal_attempts
      drop constraint if exists seat_expiration_removal_attempts_status_check,
      drop column succeeded_at,
      add constraint seat_expiration_removal_attempts_status_check
        check (status in ('retrying', 'running', 'failed'));
  `.execute(db);
}
