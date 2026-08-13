import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table automation_operations
      add column progress integer not null default 0
      check (progress between 0 and 100);
    update automation_operations set progress = case
      when status = 'succeeded' then 100
      when status = 'queued' then 0
      else 1
    end;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table automation_operations drop column if exists progress;`.execute(db);
}
