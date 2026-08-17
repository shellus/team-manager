import type { Kysely } from 'kysely';
import type { AccountManagerOperationView, OperationControl, OperationDetailView, PaymentCardInput } from '@team-manager/shared';
import type { AccountManagerGateway } from '../accountManagerClient.js';
import type { Database } from '../database/schema.js';
import { AutomationOperationRepository } from '../repositories/automationOperationRepository.js';
import { ServiceError } from '../serviceError.js';
import { AccountManagerService } from './accountManagerService.js';
import { PersonalSpaceService } from './personalSpaceService.js';
import { WorkspaceOperationService } from './workspaceOperationService.js';

export class OperationService {
  readonly #operations: AutomationOperationRepository;
  constructor(
    db: Kysely<Database>,
    private readonly accountManagerService: AccountManagerService,
    private readonly manager?: AccountManagerGateway,
    private readonly personalSpaces?: PersonalSpaceService,
    private readonly workspaceOperations?: WorkspaceOperationService
  ) { this.#operations = new AutomationOperationRepository(db); }

  async get(id: string): Promise<OperationDetailView> {
    const row = await this.requireRow(id);
    if (row.kind === 'register_account' && !row.account_id) {
      await this.accountManagerService.registration(row.id);
    }
    if (row.kind === 'import_account' && !terminal(row.status)) {
      await this.accountManagerService.reconcileEnrollment(row.id);
    }
    if (!['register_account', 'import_account'].includes(row.kind) && row.external_operation_id && this.manager?.operation && !terminal(row.status)) {
      const remote = await this.manager.operation(row.external_operation_id);
      await this.#operations.updateFromExternal(row.id, remote, row.account_id ?? undefined);
    }
    const updated = await this.requireRow(id);
    if (updated.account_id && !updated.converged_at && ['failed', 'interrupted'].includes(updated.status)) {
      await this.#operations.markConverged(updated.id);
    }
    if (updated.status === 'succeeded' && updated.account_id && !updated.converged_at) {
      await this.converge(updated);
      await this.#operations.markConverged(updated.id);
    }
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
        ...(payment.amount !== null ? { amount: String(payment.amount) } : {}),
        ...(payment.currency ? { currency: payment.currency } : {}),
        ...(payment.submitted_at ? { submittedAt: new Date(payment.submitted_at as any).toISOString() } : {}),
        createdAt: new Date(payment.created_at as any).toISOString()
      } } : {}),
      completedAt: persisted?.completed_at ? new Date(persisted.completed_at as any).getTime() : view.completedAt,
      effectiveAt: persisted?.effective_at ? new Date(persisted.effective_at as any).toISOString() : undefined });
  }

  async control(id: string, control: OperationControl) {
    const row = await this.requireRemote(id);
    if (!this.manager?.controlOperation) throw new ServiceError(503, 'GAM 操作控制未配置');
    const remote = await this.manager.controlOperation(row.external_operation_id!, control);
    await this.#operations.updateFromExternal(row.id, remote, row.account_id ?? undefined);
    return remote;
  }

  async replacePaymentCard(id: string, card: PaymentCardInput) {
    validateCard(card);
    const row = await this.requireRemote(id);
    if (!this.manager?.replaceOperationPaymentCard) throw new ServiceError(503, 'GAM 补卡未配置');
    const remote = await this.manager.replaceOperationPaymentCard(row.external_operation_id!, card);
    await this.#operations.updateFromExternal(row.id, remote, row.account_id ?? undefined);
    return remote;
  }

  async remove(id: string): Promise<boolean> {
    const row = await this.requireRow(id);
    if (!terminal(row.status)) throw new ServiceError(409, '运行中的操作不能清理，请先终止');
    if (row.external_operation_id && this.manager?.deleteOperation) await this.manager.deleteOperation(row.external_operation_id);
    await this.#operations.remove(row.id);
    return true;
  }

  async pollActive(): Promise<{ checked: number; failed: number }> {
    if (!this.manager?.operation) return { checked: 0, failed: 0 };
    const rows = await this.#operations.active();
    let failed = 0;
    for (const row of rows) {
      try { await this.get(row.id); } catch { failed += 1; }
    }
    return { checked: rows.length, failed };
  }

  private async converge(row: {
    account_id: string | null;
    workspace_id: string | null;
    kind: string;
  }): Promise<void> {
    const accountId = row.account_id!;
    if (['change_personal_subscription', 'open_business_subscription'].includes(row.kind)) {
      await this.accountManagerService.importSession(accountId);
    }
    if (['register_account', 'import_account'].includes(row.kind)) {
      await this.personalSpaces?.refresh(accountId, ['subscription', 'billing']);
      await this.workspaceOperations?.syncAccountRelationships(accountId);
      return;
    }
    if (row.kind === 'change_personal_subscription') {
      await this.personalSpaces?.refresh(accountId, ['subscription', 'billing']);
      return;
    }
    if (row.kind === 'open_business_subscription') {
      await this.workspaceOperations?.syncAccountRelationships(accountId);
      if (row.workspace_id) await this.workspaceOperations?.refreshBilling(row.workspace_id, accountId);
      else await this.workspaceOperations?.refreshManageableBillingForAccount(accountId);
      return;
    }
    if (['add_subscription_payment_method', 'add_personal_payment_method'].includes(row.kind)) {
      if (row.workspace_id) await this.workspaceOperations?.refreshBilling(row.workspace_id, accountId);
      else await this.personalSpaces?.refresh(accountId, ['billing']);
    }
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
    } as AccountManagerOperationView;
  }

  private async requireRow(id: string) {
    const row = await this.#operations.find(id);
    if (!row) throw new ServiceError(404, '操作不存在');
    return row;
  }
  private async requireRemote(id: string) {
    const row = await this.requireRow(id);
    if (!row.external_operation_id) throw new ServiceError(409, '操作尚未绑定 GAM');
    return row;
  }
}

export function startOperationPoller(service: OperationService, intervalMs = 5_000): () => void {
  const tick = () => void service.pollActive().catch((error) => console.warn('[team-manager] 操作状态同步失败:', error));
  tick();
  const timer = setInterval(tick, intervalMs); timer.unref();
  return () => clearInterval(timer);
}

function terminal(status: string): boolean { return ['succeeded', 'failed', 'interrupted'].includes(status); }
function normalizeStatus(status: string): AccountManagerOperationView['status'] {
  return ['queued', 'running', 'waiting_for_otp', 'waiting_manual', 'succeeded', 'failed', 'interrupted'].includes(status)
    ? status as AccountManagerOperationView['status'] : 'running';
}
function validateCard(card: PaymentCardInput) {
  if (!/^\d{12,19}$/.test(card.number.replaceAll(' ', ''))) throw new ServiceError(400, '卡号格式无效');
  if (card.expiryMonth < 1 || card.expiryMonth > 12 || card.expiryYear < new Date().getUTCFullYear()) throw new ServiceError(400, '卡片有效期无效');
  if (!/^\d{3,4}$/.test(card.cvc)) throw new ServiceError(400, 'CVC 格式无效');
}
