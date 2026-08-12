import type { Kysely } from 'kysely';
import type { AccountManagerOperationView } from '@team-manager/shared';
import type { Database } from '../database/schema.js';

export class AutomationOperationRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async start(input: {
    accountId: string;
    workspaceId?: string;
    kind: string;
    idempotencyKey: string;
    safeRequestSummary: Record<string, unknown>;
  }): Promise<string> {
    const existing = await this.db.selectFrom('automation_operations').select('id')
      .where('idempotency_key', '=', input.idempotencyKey).executeTakeFirst();
    if (existing) return existing.id;
    return (await this.db.insertInto('automation_operations').values({
      account_id: input.accountId,
      workspace_id: input.workspaceId ?? null,
      target_group_id: null,
      kind: input.kind,
      idempotency_key: input.idempotencyKey,
      external_operation_id: null,
      status: 'queued',
      phase: 'queued',
      safe_request_summary: input.safeRequestSummary,
      result_summary: null,
      error_code: null,
      error_message: null
    }).returning('id').executeTakeFirstOrThrow()).id;
  }

  async attach(id: string, operation: AccountManagerOperationView): Promise<void> {
    await this.db.updateTable('automation_operations').set({
      external_operation_id: operation.id,
      status: operation.status,
      phase: operation.phase,
      result_summary: operation.result ?? null,
      error_code: operation.errorCode ?? null,
      error_message: operation.errorMessage ?? null
    }).where('id', '=', id).execute();
  }
}
