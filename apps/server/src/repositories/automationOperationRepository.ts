import type { Kysely } from 'kysely';
import type { AutomationOperationView } from '@team-manager/shared';
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
      progress: 0,
      safe_request_summary: input.safeRequestSummary,
      result_summary: null,
      error_code: null,
      error_message: null
    }).returning('id').executeTakeFirstOrThrow()).id;
  }

  async listForAccount(accountId: string): Promise<AutomationOperationView[]> {
    const rows = await this.db.selectFrom('automation_operations').selectAll()
      .where('account_id', '=', accountId)
      .where('kind', 'not in', ['add_subscription_payment_method', 'add_personal_payment_method'])
      .orderBy('created_at', 'desc').execute();
    return rows.map((row) => ({
      id: row.id,
      accountId,
      type: row.kind,
      status: normalizeStatus(row.status),
      phase: row.phase ?? row.status,
      progress: row.progress,
      requestSummary: row.safe_request_summary,
      ...(row.result_summary ? { result: row.result_summary } : {}),
      ...(row.error_code ? { errorCode: row.error_code } : {}),
      ...(row.error_message ? { errorMessage: row.error_message } : {}),
      createdAt: toMillis(row.created_at),
      updatedAt: toMillis(row.updated_at)
    }));
  }

  async find(id: string) {
    return this.db.selectFrom('automation_operations').selectAll().where('id', '=', id).executeTakeFirst();
  }

  async view(id: string): Promise<AutomationOperationView> {
    const row = await this.find(id);
    if (!row) throw new Error('操作不存在');
    return operationView(row);
  }

  async completeLocal(id: string, input: { phase: string; result: Record<string, unknown> }): Promise<void> {
    const now = new Date();
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('automation_operations').set({
        status: 'succeeded', phase: input.phase, progress: 100, result_summary: input.result,
        completed_at: now, effective_at: dateFromResult(input.result, ['effectiveAt', 'activeStart', 'active_start']),
        converged_at: now
      }).where('id', '=', id).execute();
      const payment = paymentSummaryFromResult(input.result, 'succeeded');
      if (payment) {
        await trx.insertInto('payment_attempt_summaries').values({ operation_id: id, ...payment }).execute();
      }
    });
  }

  async failLocal(id: string, input: { phase: string; errorCode: string; errorMessage: string }): Promise<void> {
    await this.db.updateTable('automation_operations').set({
      status: 'failed',
      phase: input.phase,
      error_code: input.errorCode,
      error_message: input.errorMessage,
      completed_at: new Date(),
      converged_at: new Date()
    }).where('id', '=', id).execute();
  }

  events(id: string) { return this.db.selectFrom('automation_operation_events').selectAll().where('operation_id', '=', id).orderBy('occurred_at').execute(); }
  payment(id: string) { return this.db.selectFrom('payment_attempt_summaries').selectAll().where('operation_id', '=', id).orderBy('created_at', 'desc').executeTakeFirst(); }

  async remove(id: string): Promise<void> {
    await this.db.deleteFrom('automation_operations').where('id', '=', id).execute();
  }

}

function operationView(row: any): AutomationOperationView {
  return {
    id: row.id, ...(row.account_id ? { accountId: row.account_id } : {}), type: row.kind,
    status: normalizeStatus(row.status), phase: row.phase ?? row.status, progress: row.progress,
    requestSummary: row.safe_request_summary, ...(row.result_summary ? { result: row.result_summary } : {}),
    ...(row.error_code ? { errorCode: row.error_code } : {}), ...(row.error_message ? { errorMessage: row.error_message } : {}),
    createdAt: toMillis(row.created_at), updatedAt: toMillis(row.updated_at),
    ...(row.completed_at ? { completedAt: toMillis(row.completed_at) } : {})
  };
}

function dateFromResult(result: Record<string, unknown> | undefined, keys: string[]): Date | null {
  for (const key of keys) {
    const value = result?.[key];
    if (typeof value === 'string' || typeof value === 'number') {
      const parsed = new Date(value);
      if (Number.isFinite(parsed.getTime())) return parsed;
    }
  }
  return null;
}

function paymentSummaryFromResult(result: Record<string, unknown>, status: string) {
  const payment = record(result.payment) ?? record(result.paymentResult) ?? result;
  const amount = numberOrString(payment.amount);
  const last4 = text(payment.cardLast4) ?? text(payment.last4);
  if (!amount && !last4 && !text(payment.currency) && !text(payment.resultCode)) return undefined;
  return {
    target_plan: text(result.targetPlan) ?? text(result.planType) ?? null,
    result_code: text(payment.resultCode) ?? status,
    card_brand: text(payment.cardBrand) ?? text(payment.brand) ?? null,
    card_last4: last4 ?? null,
    amount: amount ?? null,
    currency: text(payment.currency) ?? null,
    submitted_at: dateFromResult(payment, ['submittedAt', 'createdAt'])
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function text(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function numberOrString(value: unknown): number | string | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : text(value);
}

function normalizeStatus(value: string): AutomationOperationView['status'] {
  return ['queued', 'running', 'succeeded', 'failed', 'interrupted'].includes(value)
    ? value as AutomationOperationView['status']
    : 'running';
}

function toMillis(value: unknown): number {
  return value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
}
