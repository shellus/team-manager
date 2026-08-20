import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    delete from account_session_revisions revision
    using accounts account
    where revision.account_id = account.id
      and (account.current_session_revision_id is null or revision.id <> account.current_session_revision_id)
  `.execute(db);
}

export async function down(_db: Kysely<unknown>): Promise<void> {
  // 已删除的敏感 Session 历史不可恢复。
}
