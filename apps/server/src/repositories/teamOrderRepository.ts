import type { Kysely } from 'kysely';
import type { Database } from '../database/schema.js';
import type { TeamOrderDashboardView, TeamOrderConfigurationView } from '@team-manager/shared';

export interface TeamOrderConfigInput {
  promoCode?: string | null;
  country?: string | null;
  currency?: string | null;
  seatQuantity?: number | null;
}

export class TeamOrderRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async saveConfiguration(workspaceId: string | null, input: TeamOrderConfigInput): Promise<void> {
    const values = {
      workspace_id: workspaceId,
      promo_code: input.promoCode?.trim() || null,
      country: input.country?.trim().toUpperCase() || null,
      currency: input.currency?.trim().toUpperCase() || null,
      seat_quantity: positiveInteger(input.seatQuantity) ?? null
    };
    const existing = workspaceId
      ? await this.db.selectFrom('team_order_configurations').select('id').where('workspace_id', '=', workspaceId).executeTakeFirst()
      : await this.db.selectFrom('team_order_configurations').select('id').where('workspace_id', 'is', null).executeTakeFirst();
    if (existing) await this.db.updateTable('team_order_configurations').set(values).where('id', '=', existing.id).execute();
    else await this.db.insertInto('team_order_configurations').values(values).execute();
  }

  async dashboard(configured: boolean): Promise<TeamOrderDashboardView> {
    const [configurationRows, maintenanceRows, orderRows] = await Promise.all([
      this.db.selectFrom('team_order_configurations as c')
        .leftJoin('workspaces as w', 'w.id', 'c.workspace_id')
        .selectAll('c').select('w.name as workspace_name').orderBy('c.created_at').execute(),
      this.db.selectFrom('team_order_maintenances as m')
        .innerJoin('workspaces as w', 'w.id', 'm.workspace_id')
        .innerJoin('accounts as a', 'a.id', 'm.executor_account_id')
        .selectAll('m').select(['w.name as workspace_name', 'w.external_id', 'a.email as executor_email'])
        .orderBy('m.updated_at', 'desc').execute(),
      this.db.selectFrom('team_upgrade_orders as o')
        .innerJoin('workspaces as w', 'w.id', 'o.workspace_id')
        .innerJoin('accounts as a', 'a.id', 'o.executor_account_id')
        .selectAll('o').select(['w.name as workspace_name', 'w.external_id', 'a.email as executor_email'])
        .orderBy('o.created_at', 'desc').limit(200).execute()
    ]);
    const configurations = configurationRows.map((row) => configurationView(row));
    const maintenances = maintenanceRows.map((row) => ({
      id: row.id, workspaceId: row.workspace_id,
      ...(row.workspace_name ? { workspaceName: row.workspace_name } : {}), workspaceExternalId: row.external_id,
      executorAccountId: row.executor_account_id, executorEmail: row.executor_email, enabled: row.enabled,
      status: (!row.enabled ? 'paused' : row.last_error ? 'attention' : orderRows.some((order) => order.workspace_id === row.workspace_id && order.status === 'running') ? 'running' : 'scheduled') as 'paused' | 'attention' | 'running' | 'scheduled',
      ...(row.next_run_at ? { nextRunAt: iso(row.next_run_at) } : {}), ...(row.last_run_at ? { lastRunAt: iso(row.last_run_at) } : {}),
      ...(row.last_success_at ? { lastSuccessAt: iso(row.last_success_at) } : {}), ...(row.last_error ? { lastError: row.last_error } : {}),
      ...(row.pause_reason ? { pauseReason: row.pause_reason } : {}),
      configuration: configurationView(row)
    }));
    const orders = orderRows.map((row) => ({
      id: row.id, workspaceId: row.workspace_id, ...(row.workspace_name ? { workspaceName: row.workspace_name } : {}),
      workspaceExternalId: row.external_id, executorAccountId: row.executor_account_id, executorEmail: row.executor_email,
      status: row.status, ...(row.checkout_url ? { checkoutUrl: row.checkout_url } : {}),
      ...(row.expires_at ? { expiresAt: iso(row.expires_at) } : {}), source: row.source,
      ...(row.scheduled_for ? { scheduledFor: iso(row.scheduled_for) } : {}), ...(row.retry_at ? { retryAt: iso(row.retry_at) } : {}),
      attemptCount: row.attempt_count, ...(row.error_message ? { errorMessage: row.error_message } : {}),
      createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
      configuration: configurationSnapshot(row.configuration_snapshot, row.workspace_id, row.workspace_name)
    }));
    return {
      configured,
      statistics: {
        maintenanceCount: maintenances.filter((item) => item.enabled).length,
        runningCount: orders.filter((item) => ['queued', 'running'].includes(item.status)).length,
        readyCount: orders.filter((item) => item.status === 'ready' && (!item.expiresAt || new Date(item.expiresAt).getTime() > Date.now())).length,
        attentionCount: maintenances.filter((item) => item.status === 'attention').length + orders.filter((item) => item.status === 'failed').length
      },
      globalConfiguration: configurations.find((item) => !item.workspaceId) ?? {},
      configurations: configurations.filter((item) => item.workspaceId), maintenances, orders
    };
  }

  async saveMaintenance(input: {
    workspaceId: string; executorAccountId: string; enabled: boolean;
    overrides?: TeamOrderConfigInput; nextRunAt?: Date | string | null;
    pauseReason?: string | null; lastSuccessAt?: Date | string | null;
    lastRunAt?: Date | string | null; lastError?: string | null;
  }): Promise<void> {
    const values = {
      workspace_id: input.workspaceId,
      executor_account_id: input.executorAccountId,
      enabled: input.enabled,
      last_run_at: input.lastRunAt ?? null,
      promo_code: input.overrides?.promoCode?.trim() || null,
      country: input.overrides?.country?.trim().toUpperCase() || null,
      currency: input.overrides?.currency?.trim().toUpperCase() || null,
      seat_quantity: positiveInteger(input.overrides?.seatQuantity) ?? null,
      next_run_at: input.nextRunAt ?? null,
      pause_reason: input.pauseReason?.trim() || null,
      last_success_at: input.lastSuccessAt ?? null,
      last_error: input.lastError?.trim() || null
    };
    await this.db.insertInto('team_order_maintenances').values(values)
      .onConflict((oc) => oc.column('workspace_id').doUpdateSet(values)).execute();
  }

  async saveOrder(input: {
    workspaceId: string; executorAccountId: string; externalOrderId?: string | null;
    checkoutUrl?: string | null; expiresAt?: Date | string | null; status: string;
    configuration: Record<string, unknown>; source: string; scheduledFor?: Date | string | null;
    taskId?: string | null; stripeCreatedAt?: Date | string | null; retryAt?: Date | string | null;
    attemptCount?: number; errorMessage?: string | null; completedAt?: Date | string | null;
  }): Promise<string> {
    const row = await this.db.insertInto('team_upgrade_orders').values({
      workspace_id: input.workspaceId, executor_account_id: input.executorAccountId,
      external_order_id: input.externalOrderId ?? null, checkout_url: input.checkoutUrl ?? null,
      expires_at: input.expiresAt ?? null, status: input.status,
      configuration_snapshot: input.configuration, source: input.source,
      scheduled_for: input.scheduledFor ?? null, task_id: input.taskId ?? null,
      stripe_created_at: input.stripeCreatedAt ?? null, retry_at: input.retryAt ?? null,
      attempt_count: input.attemptCount ?? 0, error_message: input.errorMessage ?? null,
      completed_at: input.completedAt ?? null
    }).returning('id').executeTakeFirstOrThrow();
    return row.id;
  }
}

function configurationView(row: { workspace_id?: string | null; workspace_name?: string | null; promo_code?: string | null; country?: string | null; currency?: string | null; seat_quantity?: number | null }): TeamOrderConfigurationView {
  return { ...(row.workspace_id ? { workspaceId: row.workspace_id } : {}), ...(row.workspace_name ? { workspaceName: row.workspace_name } : {}),
    ...(row.promo_code ? { promoCode: row.promo_code } : {}), ...(row.country ? { country: row.country } : {}), ...(row.currency ? { currency: row.currency } : {}),
    ...(row.seat_quantity ? { seatQuantity: row.seat_quantity } : {}) };
}
function configurationSnapshot(value: Record<string, unknown>, workspaceId: string, workspaceName?: string | null): TeamOrderConfigurationView {
  return { workspaceId, ...(workspaceName ? { workspaceName } : {}), ...(text(value.promoCode) ? { promoCode: text(value.promoCode) } : {}),
    ...(text(value.country) ? { country: text(value.country) } : {}), ...(text(value.currency) ? { currency: text(value.currency) } : {}),
    ...(positiveInteger(value.seatQuantity) ? { seatQuantity: positiveInteger(value.seatQuantity) } : {}) };
}
function text(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function positiveInteger(value: unknown): number | undefined { const parsed=Number(value);return Number.isSafeInteger(parsed)&&parsed>0?parsed:undefined; }
function iso(value: unknown): string { return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString(); }
