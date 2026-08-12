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

  async startRegistration(input: {
    targetGroupId: string;
    idempotencyKey: string;
    safeRequestSummary: Record<string, unknown>;
  }): Promise<string> {
    return (await this.db.insertInto('automation_operations').values({
      account_id: null,
      workspace_id: null,
      target_group_id: input.targetGroupId,
      kind: 'register_account',
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

  async listForAccount(accountId: string): Promise<AccountManagerOperationView[]> {
    const rows = await this.db.selectFrom('automation_operations').selectAll()
      .where('account_id', '=', accountId).orderBy('created_at', 'desc').execute();
    return rows.map((row) => ({
      id: row.id,
      accountId,
      type: row.kind,
      status: normalizeStatus(row.status),
      phase: row.phase ?? row.status,
      progress: row.status === 'succeeded' ? 100 : row.status === 'queued' ? 0 : 1,
      requestSummary: row.safe_request_summary,
      ...(row.result_summary ? { result: row.result_summary } : {}),
      ...(row.error_code ? { errorCode: row.error_code } : {}),
      ...(row.error_message ? { errorMessage: row.error_message } : {}),
      createdAt: toMillis(row.created_at),
      updatedAt: toMillis(row.updated_at)
    }));
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

  async updateFromExternal(id: string, operation: AccountManagerOperationView, accountId?: string): Promise<void> {
    await this.db.updateTable('automation_operations').set({
      ...(accountId ? { account_id: accountId } : {}),
      external_operation_id: operation.id,
      status: operation.status,
      phase: operation.phase,
      result_summary: operation.result ?? null,
      error_code: operation.errorCode ?? null,
      error_message: operation.errorMessage ?? null
    }).where('id', '=', id).execute();
  }
}

function normalizeStatus(value: string): AccountManagerOperationView['status'] {
  return ['queued', 'running', 'waiting_for_otp', 'waiting_manual', 'succeeded', 'failed', 'interrupted'].includes(value)
    ? value as AccountManagerOperationView['status']
    : 'running';
}

function toMillis(value: unknown): number {
  return value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
}
