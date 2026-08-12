import type { Kysely } from 'kysely';
import type { Database } from '../database/schema.js';

export interface TeamOrderConfigInput {
  promoCode?: string | null;
  country?: string | null;
  currency?: string | null;
}

export class TeamOrderRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async saveConfiguration(workspaceId: string | null, input: TeamOrderConfigInput): Promise<void> {
    const values = {
      workspace_id: workspaceId,
      promo_code: input.promoCode?.trim() || null,
      country: input.country?.trim().toUpperCase() || null,
      currency: input.currency?.trim().toUpperCase() || null
    };
    const existing = workspaceId
      ? await this.db.selectFrom('team_order_configurations').select('id').where('workspace_id', '=', workspaceId).executeTakeFirst()
      : await this.db.selectFrom('team_order_configurations').select('id').where('workspace_id', 'is', null).executeTakeFirst();
    if (existing) await this.db.updateTable('team_order_configurations').set(values).where('id', '=', existing.id).execute();
    else await this.db.insertInto('team_order_configurations').values(values).execute();
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
