import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table notification_deliveries
      add column payload jsonb not null default '{}'::jsonb,
      add column attempt_count integer not null default 0,
      add column max_attempts integer not null default 3,
      add column next_retry_at timestamptz,
      add column last_attempt_at timestamptz,
      add constraint notification_deliveries_attempt_count_check check (attempt_count >= 0),
      add constraint notification_deliveries_max_attempts_check check (max_attempts between 1 and 10);

    update notification_deliveries
      set payload = safe_summary,
          attempt_count = case when status = 'sending' then 0 else 1 end,
          status = case when status = 'failed' then 'exhausted' when status = 'sending' then 'retrying' else status end,
          next_retry_at = case when status = 'sending' then now() else null end;

    create index notification_deliveries_retry_due
      on notification_deliveries (next_retry_at)
      where status = 'retrying';

    create table artifact_orphans (
      id uuid primary key default gen_random_uuid(),
      storage_key text not null unique,
      content_sha256 text not null,
      byte_size bigint not null check (byte_size >= 0),
      status text not null check (status in ('pending_delete', 'deleted', 'missing')),
      discovered_at timestamptz not null,
      delete_after timestamptz not null,
      deleted_at timestamptz,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create index artifact_orphans_delete_due on artifact_orphans (delete_after)
      where status = 'pending_delete';
    create trigger artifact_orphans_updated_at before update on artifact_orphans
      for each row execute function set_updated_at();
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop table if exists artifact_orphans;
    alter table notification_deliveries
      drop constraint if exists notification_deliveries_max_attempts_check,
      drop constraint if exists notification_deliveries_attempt_count_check,
      drop column if exists last_attempt_at,
      drop column if exists next_retry_at,
      drop column if exists max_attempts,
      drop column if exists attempt_count,
      drop column if exists payload;
  `.execute(db);
}
