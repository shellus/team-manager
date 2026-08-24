import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table seat_expiration_removal_attempts (
      seat_slot_id uuid primary key references seat_slots(id) on delete cascade,
      status text not null check (status in ('retrying', 'running', 'failed')),
      attempt_count integer not null default 0 check (attempt_count between 0 and 3),
      next_attempt_at timestamptz,
      last_attempt_at timestamptz,
      last_error text,
      failed_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create index seat_expiration_removal_attempts_due
      on seat_expiration_removal_attempts (next_attempt_at)
      where status in ('retrying', 'running');
    create trigger seat_expiration_removal_attempts_updated_at before update on seat_expiration_removal_attempts
      for each row execute function set_updated_at();
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists seat_expiration_removal_attempts`.execute(db);
}
