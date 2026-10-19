import type { Kysely } from 'kysely';
import type { AutomationOperationView, OperationDetailView } from '@team-manager/shared';
import type { Database } from '../database/schema.js';
import { AutomationOperationRepository } from '../repositories/automationOperationRepository.js';
import { ServiceError } from '../serviceError.js';

/** 本地操作记录：Team Manager 直连上游完成的写操作在返回前已收敛，这里只提供查询和清理。 */
export class OperationService {
  readonly #operations: AutomationOperationRepository;
  constructor(db: Kysely<Database>) { this.#operations = new AutomationOperationRepository(db); }

  async get(id: string): Promise<OperationDetailView> {
    const view = await this.localView(id);
    const [events, payment, persisted] = await Promise.all([
      this.#operations.events(id), this.#operations.payment(id), this.#operations.find(id)
    ]);
    return Object.assign(view, {
      events: events.map((event) => ({
        id: event.id, ...(event.phase ? { phase: event.phase } : {}), status: event.status,
        payload: event.safe_payload, occurredAt: new Date(event.occurred_at as any).toISOString()
      })),
      ...(payment ? { payment: {
        id: payment.id, ...(payment.target_plan ? { targetPlan: payment.target_plan } : {}),
        resultCode: payment.result_code, ...(payment.card_brand ? { cardBrand: payment.card_brand } : {}),
        ...(payment.card_last4 ? { cardLast4: payment.card_last4 } : {}),
        ...(payment.amount !== null ? { amount: formatDecimal(payment.amount) } : {}),
        ...(payment.currency ? { currency: payment.currency } : {}),
        ...(payment.submitted_at ? { submittedAt: new Date(payment.submitted_at as any).toISOString() } : {}),
        createdAt: new Date(payment.created_at as any).toISOString()
      } } : {}),
      completedAt: persisted?.completed_at ? new Date(persisted.completed_at as any).getTime() : view.completedAt,
      effectiveAt: persisted?.effective_at ? new Date(persisted.effective_at as any).toISOString() : undefined });
  }

  async remove(id: string): Promise<boolean> {
    const row = await this.requireRow(id);
    if (!terminal(row.status)) throw new ServiceError(409, '运行中的操作不能清理');
    await this.#operations.remove(row.id);
    return true;
  }

  private async localView(id: string) {
    const row = await this.requireRow(id);
    if (row.account_id) {
      const item = (await this.#operations.listForAccount(row.account_id)).find((entry) => entry.id === id);
      if (item) return item;
    }
    return {
      id: row.id, type: row.kind, status: normalizeStatus(row.status), phase: row.phase ?? row.status,
      progress: row.progress,
      requestSummary: row.safe_request_summary, ...(row.result_summary ? { result: row.result_summary } : {}),
      ...(row.error_code ? { errorCode: row.error_code } : {}), ...(row.error_message ? { errorMessage: row.error_message } : {}),
      createdAt: new Date(row.created_at as any).getTime(), updatedAt: new Date(row.updated_at as any).getTime()
    } as AutomationOperationView;
  }

  private async requireRow(id: string) {
    const row = await this.#operations.find(id);
    if (!row) throw new ServiceError(404, '操作不存在');
    return row;
  }
}

function terminal(status: string): boolean { return ['succeeded', 'failed', 'interrupted'].includes(status); }
function normalizeStatus(status: string): AutomationOperationView['status'] {
  return ['queued', 'running', 'succeeded', 'failed', 'interrupted'].includes(status)
    ? status as AutomationOperationView['status'] : 'running';
}
function formatDecimal(value: string | number): string {
  return String(value).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}
