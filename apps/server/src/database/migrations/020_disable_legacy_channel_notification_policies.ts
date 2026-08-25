import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    update notification_policies
      set enabled = false
      where kind not in ('seat_expiration', 'workspace_renewal')
        and enabled = true
  `.execute(db);
}

export async function down(): Promise<void> {
  // 旧渠道策略是否应启用无法从数据推断；回滚不恢复危险的历史开关。
}
