import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table notification_deliveries
      add column configuration_snapshot jsonb not null default '{}'::jsonb,
      add column delivered_channels jsonb not null default '{}'::jsonb;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table notification_deliveries
      drop column delivered_channels,
      drop column configuration_snapshot
  `.execute(db);
}
