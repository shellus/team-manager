import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table seat_slots drop constraint seat_slots_role_check,
    add constraint seat_slots_role_check
      check (role in ('analytics-viewer', 'standard-user', 'account-admin', 'account-owner'))`.execute(db);
  await sql`update seat_slots s set role = (
    select case when fact.raw_role in ('analytics-viewer', 'standard-user', 'account-admin', 'account-owner') then fact.raw_role end from (
      select m.raw_role, 0 as priority from workspace_memberships m
      left join accounts a on a.id = m.account_id
      where m.workspace_id = s.workspace_id and m.status = 'active'
        and coalesce(m.normalized_email, a.normalized_email) = s.normalized_current_email
      union all
      select i.raw_role, 1 as priority from workspace_invitations i
      where i.workspace_id = s.workspace_id and i.status = 'pending'
        and i.normalized_email = s.normalized_current_email
    ) fact order by fact.priority limit 1
  ) where s.role is null`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Refuse rollback while owner roles exist rather than discard recorded facts.
  await sql`alter table seat_slots drop constraint seat_slots_role_check,
    add constraint seat_slots_role_check
      check (role in ('analytics-viewer', 'standard-user', 'account-admin'))`.execute(db);
}
