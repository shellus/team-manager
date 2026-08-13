import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table automation_operations
      add column completed_at timestamptz,
      add column effective_at timestamptz,
      add column last_polled_at timestamptz,
      add column converged_at timestamptz;
    alter table account_operational_profiles
      add column profile_status text not null default 'unknown',
      add column profile_checked_at timestamptz;
    alter table seat_slot_swap_operations
      add column from_email text,
      add column steps jsonb not null default '{"items":[]}'::jsonb,
      add column completed_at timestamptz;
    alter table seat_slots drop constraint if exists seat_slots_status_check;
    alter table seat_slots add constraint seat_slots_status_check check (status in ('empty','invited','member','unknown','disabled'));
    alter table account_activity_logs drop constraint if exists account_activity_logs_source_file_sha256_source_line_key;
    create unique index account_activity_logs_source_unique on account_activity_logs (source_file_sha256, source_line)
      where source_file_sha256 is not null and source_line is not null;
    update notification_policies
      set configuration = jsonb_strip_nulls(jsonb_build_object(
        'webhookUrl', coalesce(configuration->>'webhookUrl', configuration#>>'{channels,webhook,url}'),
        'feishuWebhookUrl', coalesce(configuration->>'feishuWebhookUrl', configuration#>>'{channels,feishu,webhookUrl}'),
        'wecomWebhookUrl', coalesce(configuration->>'wecomWebhookUrl', configuration#>>'{channels,wecom,webhookUrl}'),
        'telegramBotToken', coalesce(configuration->>'telegramBotToken', configuration#>>'{channels,telegram,botToken}'),
        'telegramChatId', coalesce(configuration->>'telegramChatId', configuration#>>'{channels,telegram,chatId}')
      ))
      where configuration ? 'channels';
    create table codex_oauth_sessions (
      id uuid primary key,
      account_id uuid not null references accounts(id) on delete cascade,
      workspace_id uuid not null references workspaces(id) on delete cascade,
      state text not null unique,
      verifier_ciphertext text not null,
      verifier_nonce text not null,
      verifier_auth_tag text not null,
      verifier_key_version text not null,
      auth_url text not null,
      expires_at timestamptz not null,
      consumed_at timestamptz,
      created_at timestamptz not null default now()
    );
    create index codex_oauth_sessions_target on codex_oauth_sessions (account_id, workspace_id, created_at desc);
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop table if exists codex_oauth_sessions;
    alter table seat_slot_swap_operations drop column if exists completed_at, drop column if exists steps, drop column if exists from_email;
    alter table automation_operations drop column if exists converged_at, drop column if exists last_polled_at, drop column if exists effective_at, drop column if exists completed_at;
    alter table account_operational_profiles drop column if exists profile_checked_at, drop column if exists profile_status;
  `.execute(db);
}
