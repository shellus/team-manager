import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table quarantined_artifacts (
      id uuid primary key default gen_random_uuid(),
      kind text not null,
      storage_key text not null unique,
      content_sha256 text not null unique,
      byte_size bigint not null check (byte_size > 0),
      reason_code text not null,
      status text not null default 'quarantined' check (status in ('quarantined', 'claimed', 'discarded')),
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create trigger quarantined_artifacts_updated_at before update on quarantined_artifacts
      for each row execute function set_updated_at();
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists quarantined_artifacts`.execute(db);
}
