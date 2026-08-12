import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create function set_updated_at() returns trigger language plpgsql as $$
    begin
      new.updated_at = now();
      return new;
    end
    $$;

    create table account_groups (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      normalized_name text not null unique,
      sort_order integer not null default 0,
      is_default boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      check (length(btrim(name)) > 0),
      check (normalized_name = lower(btrim(name)))
    );
    create unique index account_groups_single_default on account_groups (is_default) where is_default;
    create trigger account_groups_updated_at before update on account_groups for each row execute function set_updated_at();
    insert into account_groups (name, normalized_name, is_default) values ('默认分组', '默认分组', true);

    create table accounts (
      id uuid primary key default gen_random_uuid(),
      group_id uuid not null references account_groups(id) on delete restrict,
      email text not null,
      normalized_email text not null unique,
      remark text,
      is_banned boolean not null default false,
      remote_user_id text,
      display_name text,
      last_error text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      check (length(btrim(email)) > 0),
      check (normalized_email = lower(btrim(email)))
    );
    create trigger accounts_updated_at before update on accounts for each row execute function set_updated_at();

    create table account_operational_profiles (
      id uuid primary key default gen_random_uuid(),
      account_id uuid not null unique references accounts(id) on delete cascade,
      limit_type text not null default 'unknown' check (limit_type in ('unknown', 'weekly', 'monthly')),
      proxy_url_ciphertext text,
      proxy_url_nonce text,
      proxy_url_auth_tag text,
      proxy_url_key_version text,
      account_manager_plan_code text,
      account_manager_synced_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      check ((proxy_url_ciphertext is null and proxy_url_nonce is null and proxy_url_auth_tag is null and proxy_url_key_version is null)
          or (proxy_url_ciphertext is not null and proxy_url_nonce is not null and proxy_url_auth_tag is not null and proxy_url_key_version is not null))
    );
    create trigger account_operational_profiles_updated_at before update on account_operational_profiles for each row execute function set_updated_at();

    create table gam_bindings (
      id uuid primary key default gen_random_uuid(),
      account_id uuid not null unique references accounts(id) on delete cascade,
      external_account_ref text not null,
      normalized_external_account_ref text not null unique,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      check (normalized_external_account_ref = lower(btrim(external_account_ref)))
    );
    create trigger gam_bindings_updated_at before update on gam_bindings for each row execute function set_updated_at();

    create table personal_spaces (
      id uuid primary key default gen_random_uuid(),
      account_id uuid not null unique references accounts(id) on delete cascade,
      remote_account_id text unique,
      status text not null default 'active' check (status in ('active', 'inactive', 'unknown')),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create trigger personal_spaces_updated_at before update on personal_spaces for each row execute function set_updated_at();

    create table account_session_revisions (
      id uuid primary key default gen_random_uuid(),
      account_id uuid not null references accounts(id) on delete cascade,
      ciphertext text not null,
      nonce text not null,
      auth_tag text not null,
      key_version text not null,
      plaintext_sha256 text not null,
      source text not null,
      source_updated_at timestamptz,
      observed_email text,
      observed_personal_account_id text,
      created_at timestamptz not null default now(),
      unique (account_id, plaintext_sha256)
    );
    alter table accounts add column current_session_revision_id uuid references account_session_revisions(id) on delete set null;

    create table workspaces (
      id uuid primary key default gen_random_uuid(),
      external_id text not null unique,
      name text,
      status text not null default 'active' check (status in ('active', 'inactive', 'unknown')),
      raw_plan_code text,
      normalized_plan text not null default 'unknown' check (normalized_plan in ('free', 'business', 'business_usage_based', 'unknown')),
      next_renewal_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create trigger workspaces_updated_at before update on workspaces for each row execute function set_updated_at();

    create table account_access_contexts (
      id uuid primary key default gen_random_uuid(),
      account_id uuid not null references accounts(id) on delete cascade,
      personal_space_id uuid references personal_spaces(id) on delete cascade,
      workspace_id uuid references workspaces(id) on delete cascade,
      ciphertext text not null,
      nonce text not null,
      auth_tag text not null,
      key_version text not null,
      expires_at timestamptz,
      checked_at timestamptz,
      status text not null default 'unknown' check (status in ('unknown', 'valid', 'invalid')),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      check (num_nonnulls(personal_space_id, workspace_id) = 1),
      unique nulls not distinct (account_id, personal_space_id, workspace_id)
    );
    create trigger account_access_contexts_updated_at before update on account_access_contexts for each row execute function set_updated_at();

    create table workspace_memberships (
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null references workspaces(id) on delete cascade,
      account_id uuid references accounts(id) on delete set null,
      remote_user_id text,
      email text,
      normalized_email text,
      display_name text,
      raw_role text,
      normalized_role text not null check (normalized_role in ('owner', 'admin', 'member', 'analytics_viewer', 'unknown')),
      seat_type text check (seat_type in ('default', 'usage_based')),
      status text not null default 'active' check (status in ('active', 'removed', 'unknown')),
      joined_at timestamptz,
      observed_at timestamptz not null,
      source text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      check (account_id is not null or remote_user_id is not null or normalized_email is not null)
    );
    create unique index workspace_memberships_active_account on workspace_memberships (workspace_id, account_id) where account_id is not null and status = 'active';
    create unique index workspace_memberships_active_remote_user on workspace_memberships (workspace_id, remote_user_id) where remote_user_id is not null and status = 'active';
    create unique index workspace_memberships_active_email on workspace_memberships (workspace_id, normalized_email) where normalized_email is not null and status = 'active';
    create trigger workspace_memberships_updated_at before update on workspace_memberships for each row execute function set_updated_at();

    create table workspace_invitations (
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null references workspaces(id) on delete cascade,
      account_id uuid references accounts(id) on delete set null,
      remote_invitation_id text,
      email text not null,
      normalized_email text not null,
      raw_role text,
      normalized_role text not null check (normalized_role in ('owner', 'admin', 'member', 'analytics_viewer', 'unknown')),
      seat_type text check (seat_type in ('default', 'usage_based')),
      status text not null default 'pending' check (status in ('pending', 'accepted', 'expired', 'revoked', 'unknown')),
      invited_at timestamptz,
      observed_at timestamptz not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create unique index workspace_invitations_pending_remote on workspace_invitations (workspace_id, remote_invitation_id) where remote_invitation_id is not null and status = 'pending';
    create unique index workspace_invitations_pending_email on workspace_invitations (workspace_id, normalized_email) where status = 'pending';
    create trigger workspace_invitations_updated_at before update on workspace_invitations for each row execute function set_updated_at();

    create table credential_pool_groups (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      normalized_name text not null unique,
      sort_order integer not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create trigger credential_pool_groups_updated_at before update on credential_pool_groups for each row execute function set_updated_at();

    create table workspace_credentials (
      id uuid primary key default gen_random_uuid(),
      account_id uuid not null references accounts(id) on delete restrict,
      workspace_id uuid not null references workspaces(id) on delete restrict,
      pool_group_id uuid references credential_pool_groups(id) on delete set null,
      kind text not null check (kind in ('oauth', 'pat')),
      external_id text,
      storage_key text not null unique,
      content_sha256 text not null unique,
      byte_size integer not null check (byte_size > 0),
      format_version integer not null check (format_version > 0),
      eligibility_source text not null check (eligibility_source in ('membership', 'invitation', 'migration')),
      status text not null default 'active' check (status in ('active', 'disabled', 'revoked', 'unknown')),
      disabled_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create unique index workspace_credentials_external_id on workspace_credentials (external_id) where external_id is not null;
    create trigger workspace_credentials_updated_at before update on workspace_credentials for each row execute function set_updated_at();

    create table seat_slots (
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null references workspaces(id) on delete restrict,
      seat_key text not null unique,
      current_email text,
      normalized_current_email text,
      contact text,
      remark text,
      price text,
      expires_on date,
      expire_reminder boolean not null default false,
      seat_type text not null check (seat_type in ('default', 'usage_based')),
      status text not null check (status in ('empty', 'invited', 'member', 'unknown')),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create trigger seat_slots_updated_at before update on seat_slots for each row execute function set_updated_at();

    create table seat_slot_identity_history (
      id uuid primary key default gen_random_uuid(),
      seat_slot_id uuid not null references seat_slots(id) on delete cascade,
      previous_email text,
      next_email text,
      changed_at timestamptz not null,
      reason text not null,
      created_at timestamptz not null default now()
    );

    create table seat_slot_swap_operations (
      id uuid primary key default gen_random_uuid(),
      seat_slot_id uuid not null references seat_slots(id) on delete cascade,
      idempotency_key text not null unique,
      status text not null check (status in ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
      requested_email text not null,
      error_message text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create unique index seat_slot_swap_one_active on seat_slot_swap_operations (seat_slot_id) where status in ('pending', 'running');
    create trigger seat_slot_swap_operations_updated_at before update on seat_slot_swap_operations for each row execute function set_updated_at();

    create table automation_operations (
      id uuid primary key default gen_random_uuid(),
      account_id uuid references accounts(id) on delete restrict,
      workspace_id uuid references workspaces(id) on delete restrict,
      target_group_id uuid references account_groups(id) on delete restrict,
      kind text not null,
      idempotency_key text not null unique,
      external_operation_id text,
      status text not null,
      phase text,
      safe_request_summary jsonb not null default '{}'::jsonb,
      result_summary jsonb,
      error_code text,
      error_message text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      check (kind = 'register_account' or account_id is not null)
    );
    create unique index automation_operations_external on automation_operations (external_operation_id) where external_operation_id is not null;
    create trigger automation_operations_updated_at before update on automation_operations for each row execute function set_updated_at();

    create table automation_operation_events (
      id uuid primary key default gen_random_uuid(),
      operation_id uuid not null references automation_operations(id) on delete cascade,
      phase text,
      status text not null,
      safe_payload jsonb not null default '{}'::jsonb,
      occurred_at timestamptz not null,
      created_at timestamptz not null default now()
    );

    create table payment_attempt_summaries (
      id uuid primary key default gen_random_uuid(),
      operation_id uuid not null references automation_operations(id) on delete cascade,
      target_plan text,
      result_code text not null,
      card_brand text,
      card_last4 text,
      amount numeric(20, 6),
      currency text,
      submitted_at timestamptz,
      created_at timestamptz not null default now()
    );

    create table personal_subscription_snapshots (
      id uuid primary key default gen_random_uuid(), personal_space_id uuid not null references personal_spaces(id) on delete cascade,
      normalized_plan text not null check (normalized_plan in ('free', 'go', 'plus', 'pro_5x', 'pro_20x', 'unknown')),
      raw_plan_code text, status text not null, will_renew boolean, effective_at timestamptz, ends_at timestamptz,
      payload jsonb not null, observed_at timestamptz not null, created_at timestamptz not null default now()
    );

    create table workspace_subscription_snapshots (
      id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id) on delete cascade,
      normalized_plan text not null, raw_plan_code text, status text not null, will_renew boolean,
      effective_at timestamptz, ends_at timestamptz, payload jsonb not null, observed_at timestamptz not null, created_at timestamptz not null default now()
    );

    create table personal_setting_snapshots (
      id uuid primary key default gen_random_uuid(), personal_space_id uuid not null references personal_spaces(id) on delete cascade,
      payload jsonb not null, observed_at timestamptz not null, created_at timestamptz not null default now()
    );
    create table personal_quota_snapshots (
      id uuid primary key default gen_random_uuid(), personal_space_id uuid not null references personal_spaces(id) on delete cascade,
      payload jsonb not null, observed_at timestamptz not null, created_at timestamptz not null default now()
    );
    create table workspace_setting_snapshots (
      id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id) on delete cascade,
      payload jsonb not null, observed_at timestamptz not null, created_at timestamptz not null default now()
    );
    create table credential_quota_snapshots (
      id uuid primary key default gen_random_uuid(), credential_id uuid not null references workspace_credentials(id) on delete cascade,
      payload jsonb not null, observed_at timestamptz not null, created_at timestamptz not null default now()
    );
    create table billing_snapshots (
      id uuid primary key default gen_random_uuid(), personal_space_id uuid references personal_spaces(id) on delete cascade,
      workspace_id uuid references workspaces(id) on delete cascade, payload jsonb not null,
      observed_at timestamptz not null, created_at timestamptz not null default now(),
      check (num_nonnulls(personal_space_id, workspace_id) = 1)
    );
    create table billing_invoices (
      id uuid primary key default gen_random_uuid(), billing_snapshot_id uuid not null references billing_snapshots(id) on delete cascade,
      external_id text, amount numeric(20, 6), currency text, status text, occurred_at timestamptz,
      payload jsonb not null, created_at timestamptz not null default now()
    );
    create table payment_method_summaries (
      id uuid primary key default gen_random_uuid(), personal_space_id uuid references personal_spaces(id) on delete cascade,
      workspace_id uuid references workspaces(id) on delete cascade, brand text, last4 text, expiry_month integer, expiry_year integer,
      is_default boolean not null default false, observed_at timestamptz not null, created_at timestamptz not null default now(),
      check (num_nonnulls(personal_space_id, workspace_id) = 1)
    );

    create table team_order_configurations (
      id uuid primary key default gen_random_uuid(), workspace_id uuid unique references workspaces(id) on delete cascade,
      promo_code text, country text, currency text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create trigger team_order_configurations_updated_at before update on team_order_configurations for each row execute function set_updated_at();
    create table team_order_maintenances (
      id uuid primary key default gen_random_uuid(), workspace_id uuid not null unique references workspaces(id) on delete cascade,
      executor_account_id uuid not null references accounts(id) on delete restrict, enabled boolean not null default true,
      last_run_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create trigger team_order_maintenances_updated_at before update on team_order_maintenances for each row execute function set_updated_at();
    create table team_upgrade_orders (
      id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id) on delete restrict,
      executor_account_id uuid not null references accounts(id) on delete restrict, external_order_id text, checkout_url text,
      expires_at timestamptz, status text not null, configuration_snapshot jsonb not null,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create trigger team_upgrade_orders_updated_at before update on team_upgrade_orders for each row execute function set_updated_at();

    create table system_settings (
      key text primary key, value jsonb not null, is_secret boolean not null default false,
      ciphertext text, nonce text, auth_tag text, key_version text, updated_at timestamptz not null default now(),
      check ((not is_secret and ciphertext is null and nonce is null and auth_tag is null and key_version is null)
          or (is_secret and ciphertext is not null and nonce is not null and auth_tag is not null and key_version is not null))
    );
    create table notification_policies (
      id uuid primary key default gen_random_uuid(), kind text not null unique, enabled boolean not null default false,
      configuration jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create trigger notification_policies_updated_at before update on notification_policies for each row execute function set_updated_at();
    create table notification_deliveries (
      id uuid primary key default gen_random_uuid(), policy_id uuid not null references notification_policies(id) on delete cascade,
      status text not null, safe_summary jsonb not null, error_message text, delivered_at timestamptz, created_at timestamptz not null default now()
    );

    create table account_activity_logs (
      id uuid primary key default gen_random_uuid(), account_id uuid references accounts(id) on delete set null,
      workspace_id uuid references workspaces(id) on delete set null, kind text not null, payload jsonb not null,
      source_file_sha256 text, source_line integer, source_bytes_sha256 text,
      occurred_at timestamptz not null, created_at timestamptz not null default now(),
      unique nulls not distinct (source_file_sha256, source_line)
    );

    create table upstream_trace_segments (
      id uuid primary key default gen_random_uuid(), storage_key text not null unique, content_sha256 text not null unique,
      byte_size bigint not null check (byte_size >= 0), format_version integer not null, status text not null default 'active',
      recorded_at timestamptz not null, expires_at timestamptz, metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create trigger upstream_trace_segments_updated_at before update on upstream_trace_segments for each row execute function set_updated_at();
    create table rrweb_recordings (
      id uuid primary key default gen_random_uuid(), storage_key text not null unique, content_sha256 text not null unique,
      byte_size bigint not null check (byte_size > 0), format_version integer not null, status text not null default 'active',
      recorded_at timestamptz not null, expires_at timestamptz, metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create trigger rrweb_recordings_updated_at before update on rrweb_recordings for each row execute function set_updated_at();
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop table if exists rrweb_recordings, upstream_trace_segments, account_activity_logs,
      notification_deliveries, notification_policies, system_settings, team_upgrade_orders,
      team_order_maintenances, team_order_configurations, payment_method_summaries,
      billing_invoices, billing_snapshots, credential_quota_snapshots, workspace_setting_snapshots,
      personal_quota_snapshots, personal_setting_snapshots, workspace_subscription_snapshots,
      personal_subscription_snapshots, payment_attempt_summaries, automation_operation_events,
      automation_operations, seat_slot_swap_operations, seat_slot_identity_history, seat_slots,
      workspace_credentials, credential_pool_groups, workspace_invitations, workspace_memberships,
      account_access_contexts, workspaces, account_session_revisions, personal_spaces,
      gam_bindings, account_operational_profiles, accounts, account_groups cascade;
    drop function if exists set_updated_at();
  `.execute(db);
}
