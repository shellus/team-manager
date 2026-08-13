import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table billing_snapshots
      add column normalized_workspace_plan text
      check (normalized_workspace_plan in ('business', 'business_usage_based', 'unknown'));

    update billing_snapshots
    set normalized_workspace_plan = case
      when workspace_id is null then null
      when jsonb_path_exists(payload, '$.** ? (@ like_regex "chatgptteamplan" flag "i")') then 'business'
      else 'unknown'
    end;

    create index workspace_memberships_active_account_lookup
      on workspace_memberships (account_id, normalized_role, workspace_id)
      where account_id is not null and status = 'active';
    create index personal_subscription_snapshots_latest
      on personal_subscription_snapshots (personal_space_id, observed_at desc, created_at desc);
    create index workspace_subscription_snapshots_latest
      on workspace_subscription_snapshots (workspace_id, observed_at desc, created_at desc);
    create index billing_snapshots_workspace_latest
      on billing_snapshots (workspace_id, observed_at desc, created_at desc)
      where workspace_id is not null;

    create view account_operational_summaries as
    with account_personal_plan as (
      select a.id account_id,
        coalesce(
          latest_subscription.normalized_plan,
          case
            when lower(coalesce(op.account_manager_plan_code, '')) in ('free', 'go', 'plus', 'pro_5x', 'pro_20x')
              then lower(op.account_manager_plan_code)
            when lower(coalesce(op.account_manager_plan_code, '')) like '%prolite%' then 'pro_5x'
            when lower(coalesce(op.account_manager_plan_code, '')) like '%pro%' then 'pro_20x'
            when lower(coalesce(op.account_manager_plan_code, '')) like '%plus%' then 'plus'
            when lower(coalesce(op.account_manager_plan_code, '')) like '%go%' then 'go'
            when op.account_manager_plan_code is not null then 'unknown'
            else 'free'
          end
        ) personal_plan,
        op.limit_type,
        op.profile_status
      from accounts a
      join personal_spaces ps on ps.account_id = a.id
      join account_operational_profiles op on op.account_id = a.id
      left join lateral (
        select pss.normalized_plan
        from personal_subscription_snapshots pss
        where pss.personal_space_id = ps.id
        order by pss.observed_at desc, pss.created_at desc
        limit 1
      ) latest_subscription on true
    ), account_workspace_facts as (
      select a.id account_id,
        bool_or(wm.normalized_role = 'owner') filter (where wm.id is not null) has_owner,
        count(wm.id) > 0 has_membership,
        bool_or(
          wm.normalized_role = 'owner' and (
            w.normalized_plan = 'business'
            or latest_subscription.normalized_plan = 'business'
            or latest_billing.normalized_workspace_plan = 'business'
          )
        ) filter (where wm.id is not null) has_two_seat_owner,
        bool_or(
          wm.normalized_role = 'owner' and (
            w.normalized_plan = 'business_usage_based'
            or latest_subscription.normalized_plan = 'business_usage_based'
          )
        ) filter (where wm.id is not null) has_usage_based_owner
      from accounts a
      left join workspace_memberships wm
        on wm.account_id = a.id and wm.status = 'active'
        and exists (select 1 from workspaces active_workspace where active_workspace.id = wm.workspace_id and active_workspace.status = 'active')
      left join workspaces w
        on w.id = wm.workspace_id and w.status = 'active'
      left join lateral (
        select wss.normalized_plan
        from workspace_subscription_snapshots wss
        where wss.workspace_id = w.id
        order by wss.observed_at desc, wss.created_at desc
        limit 1
      ) latest_subscription on true
      left join lateral (
        select bs.normalized_workspace_plan
        from billing_snapshots bs
        where bs.workspace_id = w.id
        order by bs.observed_at desc, bs.created_at desc
        limit 1
      ) latest_billing on true
      group by a.id
    )
    select pp.account_id,
      pp.personal_plan,
      case
        when pp.personal_plan in ('go', 'plus', 'pro_5x', 'pro_20x') then pp.personal_plan
        when coalesce(wf.has_two_seat_owner, false) then 'business_two_seat'
        when coalesce(wf.has_usage_based_owner, false) then 'business_usage_based'
        when coalesce(wf.has_membership, false) and not coalesce(wf.has_owner, false) then 'team_member'
        when pp.personal_plan = 'unknown' then 'unknown'
        else 'free'
      end primary_plan,
      pp.limit_type,
      pp.profile_status
    from account_personal_plan pp
    left join account_workspace_facts wf on wf.account_id = pp.account_id;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop view if exists account_operational_summaries;
    drop index if exists billing_snapshots_workspace_latest;
    drop index if exists workspace_subscription_snapshots_latest;
    drop index if exists personal_subscription_snapshots_latest;
    drop index if exists workspace_memberships_active_account_lookup;
    alter table billing_snapshots drop column if exists normalized_workspace_plan;
  `.execute(db);
}
