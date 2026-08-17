import { sql, type Kysely } from 'kysely';
import { up as restorePreviousView } from './012_primary_plan_seat_usage.js';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop view account_operational_summaries;
    create view account_operational_summaries as
    with account_personal_plan as (
      select a.id account_id,
        coalesce(latest_subscription.normalized_plan, 'unknown') personal_plan,
        latest_subscription.will_renew personal_will_renew,
        latest_subscription.ends_at personal_lifecycle_at,
        op.limit_type, op.profile_status
      from accounts a
      join personal_spaces ps on ps.account_id=a.id
      join account_operational_profiles op on op.account_id=a.id
      left join lateral (
        select pss.normalized_plan,pss.will_renew,pss.ends_at
        from personal_subscription_snapshots pss where pss.personal_space_id=ps.id
        order by pss.observed_at desc,pss.created_at desc limit 1
      ) latest_subscription on true
    ), workspace_candidates as (
      select wm.account_id,w.id workspace_id,
        case
          when w.normalized_plan='business' or latest_subscription.normalized_plan='business' or latest_billing.normalized_workspace_plan='business' then 'business_two_seat'
          when w.normalized_plan='business_usage_based' or latest_subscription.normalized_plan='business_usage_based' then 'business_usage_based'
        end candidate_plan,
        coalesce(w.next_renewal_at,latest_subscription.ends_at) lifecycle_at,
        (
          select count(*)::int from (
            select member.id from workspace_memberships member
            where member.workspace_id=w.id and member.status='active' and member.seat_type='default'
            union all
            select invitation.id from workspace_invitations invitation
            where invitation.workspace_id=w.id and invitation.status='pending' and invitation.seat_type='default'
          ) chatgpt_seats
        ) chatgpt_seat_count
      from workspace_memberships wm
      join workspaces w on w.id=wm.workspace_id and w.status='active'
      left join lateral (
        select wss.normalized_plan,wss.ends_at from workspace_subscription_snapshots wss
        where wss.workspace_id=w.id order by wss.observed_at desc,wss.created_at desc limit 1
      ) latest_subscription on true
      left join lateral (
        select bs.normalized_workspace_plan from billing_snapshots bs where bs.workspace_id=w.id
        order by bs.observed_at desc,bs.created_at desc limit 1
      ) latest_billing on true
      where wm.status='active' and wm.normalized_role='owner'
    ), account_workspace_facts as (
      select a.id account_id,
        bool_or(wm.normalized_role='owner') filter(where wm.id is not null) has_owner,
        count(wm.id)>0 has_membership,
        bool_or(wc.candidate_plan='business_two_seat') has_two_seat_owner,
        bool_or(wc.candidate_plan='business_usage_based') has_usage_based_owner,
        coalesce(
          min(wc.lifecycle_at) filter(where wc.candidate_plan='business_two_seat' and wc.lifecycle_at>=now()),
          max(wc.lifecycle_at) filter(where wc.candidate_plan='business_two_seat')
        ) two_seat_lifecycle_at,
        coalesce(
          min(wc.lifecycle_at) filter(where wc.candidate_plan='business_usage_based' and wc.lifecycle_at>=now()),
          max(wc.lifecycle_at) filter(where wc.candidate_plan='business_usage_based')
        ) usage_lifecycle_at,
        (array_agg(wc.workspace_id order by
          case when wc.lifecycle_at>=now() then 0 else 1 end,
          case when wc.lifecycle_at>=now() then wc.lifecycle_at end asc nulls last,
          case when wc.lifecycle_at<now() then wc.lifecycle_at end desc nulls last,
          wc.workspace_id
        ) filter(where wc.candidate_plan='business_two_seat'))[1] two_seat_workspace_id,
        (array_agg(wc.chatgpt_seat_count order by
          case when wc.lifecycle_at>=now() then 0 else 1 end,
          case when wc.lifecycle_at>=now() then wc.lifecycle_at end asc nulls last,
          case when wc.lifecycle_at<now() then wc.lifecycle_at end desc nulls last,
          wc.workspace_id
        ) filter(where wc.candidate_plan='business_two_seat'))[1] two_seat_chatgpt_seat_count
      from accounts a
      left join workspace_memberships wm on wm.account_id=a.id and wm.status='active'
        and exists(select 1 from workspaces aw where aw.id=wm.workspace_id and aw.status='active')
      left join workspace_candidates wc on wc.account_id=a.id
      group by a.id
    )
    select pp.account_id,pp.personal_plan,
      case when pp.personal_plan in ('go','plus','pro_5x','pro_20x') then pp.personal_plan
        when coalesce(wf.has_two_seat_owner,false) then 'business_two_seat'
        when coalesce(wf.has_usage_based_owner,false) then 'business_usage_based'
        when coalesce(wf.has_membership,false) and not coalesce(wf.has_owner,false) then 'team_member'
        when pp.personal_plan='unknown' then 'unknown' else 'free' end primary_plan,
      case when pp.personal_plan in ('go','plus','pro_5x','pro_20x') then null
        when coalesce(wf.has_two_seat_owner,false) then wf.two_seat_workspace_id end primary_workspace_id,
      case when pp.personal_plan in ('go','plus','pro_5x','pro_20x') then null
        when coalesce(wf.has_two_seat_owner,false) then coalesce(wf.two_seat_chatgpt_seat_count,0) end primary_chatgpt_seat_count,
      case when pp.personal_plan in ('go','plus','pro_5x','pro_20x') then pp.personal_lifecycle_at
        when coalesce(wf.has_two_seat_owner,false) then wf.two_seat_lifecycle_at
        when coalesce(wf.has_usage_based_owner,false) then wf.usage_lifecycle_at end lifecycle_at,
      case when pp.personal_plan in ('go','plus','pro_5x','pro_20x') then pp.personal_will_renew
        when coalesce(wf.has_two_seat_owner,false) or coalesce(wf.has_usage_based_owner,false) then true end lifecycle_will_renew,
      pp.limit_type,pp.profile_status
    from account_personal_plan pp left join account_workspace_facts wf on wf.account_id=pp.account_id;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await restorePreviousView(db);
}
