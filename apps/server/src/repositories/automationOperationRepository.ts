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
      progress: 0,
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
      progress: 0,
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

  async view(id: string): Promise<AccountManagerOperationView> {
    const row = await this.find(id);
    if (!row) throw new Error('操作不存在');
    return operationView(row);
  }

  async completeLocal(id: string, input: { phase: string; result: Record<string, unknown> }): Promise<void> {
    const now = new Date();
    await this.db.updateTable('automation_operations').set({
      status: 'succeeded', phase: input.phase, progress: 100, result_summary: input.result,
      completed_at: now, effective_at: dateFromResult(input.result, ['effectiveAt', 'activeStart', 'active_start']),
      converged_at: now
    }).where('id', '=', id).execute();
  }

  async active(limit = 100) {
    return this.db.selectFrom('automation_operations').selectAll()
      .where((eb) => eb.or([
        eb('status', 'in', ['queued', 'running', 'waiting_for_otp', 'waiting_manual']),
        eb.and([eb('status', 'in', ['succeeded', 'failed', 'interrupted']), eb('account_id', 'is not', null), eb('converged_at', 'is', null)])
      ]))
      .where('external_operation_id', 'is not', null).orderBy('updated_at').limit(limit).execute();
  }

  async markConverged(id: string): Promise<void> { await this.db.updateTable('automation_operations').set({ converged_at: new Date() }).where('id', '=', id).execute(); }
  events(id: string) { return this.db.selectFrom('automation_operation_events').selectAll().where('operation_id', '=', id).orderBy('occurred_at').execute(); }
  payment(id: string) { return this.db.selectFrom('payment_attempt_summaries').selectAll().where('operation_id', '=', id).orderBy('created_at', 'desc').executeTakeFirst(); }

  async remove(id: string): Promise<void> {
    await this.db.deleteFrom('automation_operations').where('id', '=', id).execute();
  }

  async attach(id: string, operation: AccountManagerOperationView): Promise<void> {
    await this.updateFromExternal(id, operation);
  }

  async updateFromExternal(id: string, operation: AccountManagerOperationView, accountId?: string): Promise<void> {
    const now = new Date();
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('automation_operations').set({
        ...(accountId ? { account_id: accountId } : {}),
        external_operation_id: operation.id,
        status: operation.status,
        phase: operation.phase,
        progress: clampProgress(operation.progress),
        result_summary: operation.result ?? null,
        error_code: operation.errorCode ?? null,
        error_message: operation.errorMessage ?? null,
        last_polled_at: now,
        completed_at: terminal(operation.status) ? new Date(operation.completedAt ?? operation.updatedAt) : null,
        effective_at: dateFromResult(operation.result, ['effectiveAt', 'activeStart', 'active_start'])
      }).where('id', '=', id).execute();
      await trx.insertInto('automation_operation_events').values({
        operation_id: id, phase: operation.phase, status: operation.status,
        safe_payload: {
          progress: operation.progress,
          ...(operation.message ? { message: operation.message } : {}),
          ...(operation.result ? { result: operation.result } : {}),
          ...(operation.errorCode ? { errorCode: operation.errorCode } : {}),
          ...(operation.errorMessage ? { errorMessage: operation.errorMessage } : {})
        },
        occurred_at: new Date(operation.updatedAt || Date.now())
      }).execute();
      const payment = paymentSummary(operation);
      if (payment) {
        const existing = await trx.selectFrom('payment_attempt_summaries').select('id')
          .where('operation_id', '=', id).executeTakeFirst();
        if (existing) await trx.updateTable('payment_attempt_summaries').set(payment).where('id', '=', existing.id).execute();
        else await trx.insertInto('payment_attempt_summaries').values({ operation_id: id, ...payment }).execute();
      }
    });
  }
}

function operationView(row: any): AccountManagerOperationView {
  return {
    id: row.id, ...(row.account_id ? { accountId: row.account_id } : {}), type: row.kind,
    status: normalizeStatus(row.status), phase: row.phase ?? row.status, progress: row.progress,
    requestSummary: row.safe_request_summary, ...(row.result_summary ? { result: row.result_summary } : {}),
    ...(row.error_code ? { errorCode: row.error_code } : {}), ...(row.error_message ? { errorMessage: row.error_message } : {}),
    createdAt: toMillis(row.created_at), updatedAt: toMillis(row.updated_at),
    ...(row.completed_at ? { completedAt: toMillis(row.completed_at) } : {})
  };
}

function clampProgress(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(100, Math.max(0, Math.round(parsed))) : 0;
}

function terminal(status: string): boolean {
  return ['succeeded', 'failed', 'interrupted'].includes(status);
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

function paymentSummary(operation: AccountManagerOperationView) {
  const result = operation.result;
  if (!result || !['succeeded', 'failed', 'interrupted'].includes(operation.status)) return undefined;
  const payment = record(result.payment) ?? record(result.paymentResult) ?? result;
  const amount = numberOrString(payment.amount);
  const last4 = text(payment.cardLast4) ?? text(payment.last4);
  if (!amount && !last4 && !text(payment.currency) && !text(payment.resultCode)) return undefined;
  return {
    target_plan: text(result.targetPlan) ?? text(result.planType) ?? null,
    result_code: text(payment.resultCode) ?? operation.status,
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

function normalizeStatus(value: string): AccountManagerOperationView['status'] {
  return ['queued', 'running', 'waiting_for_otp', 'waiting_manual', 'succeeded', 'failed', 'interrupted'].includes(value)
    ? value as AccountManagerOperationView['status']
    : 'running';
}

function toMillis(value: unknown): number {
  return value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
}
