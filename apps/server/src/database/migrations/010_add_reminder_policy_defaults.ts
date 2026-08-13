import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    insert into notification_policies (kind, enabled, configuration)
    values
      ('seat_expiration', false, '{"advanceDays":7,"triggerTime":"09:00","timeZone":"Asia/Shanghai","webhookEnabled":false,"feishuEnabled":false,"wecomEnabled":false,"telegramEnabled":false}'::jsonb),
      ('workspace_renewal', false, '{"advanceDays":7,"triggerTime":"09:00","timeZone":"Asia/Shanghai","webhookEnabled":false,"feishuEnabled":false,"wecomEnabled":false,"telegramEnabled":false}'::jsonb)
    on conflict (kind) do nothing
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`delete from notification_policies where kind in ('seat_expiration', 'workspace_renewal') and enabled = false`.execute(db);
}
