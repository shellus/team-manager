import type { Kysely } from 'kysely';
import type { Database } from '../database/schema.js';

export class ActivityLogRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async log(input: {
    accountId?: string | null;
    workspaceId?: string | null;
    kind: string;
    payload?: Record<string, unknown>;
    occurredAt?: Date;
  }): Promise<void> {
    await this.db.insertInto('account_activity_logs').values({
      account_id: input.accountId ?? null,
      workspace_id: input.workspaceId ?? null,
      kind: input.kind,
      payload: input.payload ?? {},
      source_file_sha256: null,
      source_line: null,
      source_bytes_sha256: null,
      occurred_at: input.occurredAt ?? new Date()
    }).execute();
  }
}
