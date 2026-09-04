import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table workspaces
      add column preferred_manager_account_id uuid references accounts(id) on delete set null
  `.execute(db);
  await sql`
    create index workspaces_preferred_manager_account
      on workspaces (preferred_manager_account_id)
      where preferred_manager_account_id is not null
  `.execute(db);
  await sql`
    with single_owner as (
      select workspace_id, min(account_id::text)::uuid account_id
      from workspace_memberships
      where status = 'active' and normalized_role = 'owner'
      group by workspace_id
      having count(*) = 1 and count(account_id) = 1
    )
    update workspaces workspace
    set preferred_manager_account_id = single_owner.account_id
    from single_owner
    where workspace.id = single_owner.workspace_id
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`drop index if exists workspaces_preferred_manager_account`.execute(db);
  await sql`alter table workspaces drop column if exists preferred_manager_account_id`.execute(db);
}
