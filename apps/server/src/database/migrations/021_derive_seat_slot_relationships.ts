import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table seat_slots
      drop constraint if exists seat_slots_status_check,
      drop column status,
      drop column remote_user_id;

    alter table seat_slots
      add constraint seat_slots_email_pair_check check (
        (current_email is null and normalized_current_email is null)
        or (
          current_email is not null
          and normalized_current_email = lower(btrim(current_email))
        )
      );

    create unique index seat_slots_workspace_email_unique
      on seat_slots (workspace_id, normalized_current_email)
      where normalized_current_email is not null;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop index if exists seat_slots_workspace_email_unique;
    alter table seat_slots drop constraint if exists seat_slots_email_pair_check;
    alter table seat_slots
      add column remote_user_id text,
      add column status text;

    update seat_slots slot set
      remote_user_id = (
        select membership.remote_user_id
        from workspace_memberships membership
        where membership.workspace_id = slot.workspace_id
          and membership.normalized_email = slot.normalized_current_email
          and membership.status = 'active'
        limit 1
      ),
      status = case
        when slot.current_email is null then 'empty'
        when exists (
          select 1 from workspace_memberships membership
          where membership.workspace_id = slot.workspace_id
            and membership.normalized_email = slot.normalized_current_email
            and membership.status = 'active'
        ) then 'member'
        when exists (
          select 1 from workspace_invitations pending
          where pending.workspace_id = slot.workspace_id
            and pending.normalized_email = slot.normalized_current_email
            and pending.status = 'pending'
        ) then 'invited'
        else 'unknown'
      end;

    alter table seat_slots alter column status set not null;
    alter table seat_slots add constraint seat_slots_status_check
      check (status in ('empty', 'invited', 'member', 'unknown', 'disabled'));
  `.execute(db);
}
