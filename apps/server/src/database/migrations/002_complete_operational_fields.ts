import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table seat_slots
      add column remote_user_id text,
      add column expire_remove boolean not null default false;

    alter table team_order_maintenances
      add column promo_code text,
      add column country text,
      add column currency text,
      add column next_run_at timestamptz,
      add column pause_reason text,
      add column last_success_at timestamptz,
      add column last_error text;

    alter table team_upgrade_orders
      add column source text not null default 'manual',
      add column scheduled_for timestamptz,
      add column task_id text,
      add column stripe_created_at timestamptz,
      add column retry_at timestamptz,
      add column attempt_count integer not null default 0,
      add column error_message text,
      add column completed_at timestamptz,
      add constraint team_upgrade_orders_attempt_count_check check (attempt_count >= 0);
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table team_upgrade_orders
      drop constraint if exists team_upgrade_orders_attempt_count_check,
      drop column if exists completed_at,
      drop column if exists error_message,
      drop column if exists attempt_count,
      drop column if exists retry_at,
      drop column if exists stripe_created_at,
      drop column if exists task_id,
      drop column if exists scheduled_for,
      drop column if exists source;
    alter table team_order_maintenances
      drop column if exists last_error,
      drop column if exists last_success_at,
      drop column if exists pause_reason,
      drop column if exists next_run_at,
      drop column if exists currency,
      drop column if exists country,
      drop column if exists promo_code;
    alter table seat_slots
      drop column if exists expire_remove,
      drop column if exists remote_user_id;
  `.execute(db);
}
