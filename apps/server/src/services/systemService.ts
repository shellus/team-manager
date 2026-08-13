import type { Kysely } from 'kysely';
import type { Database } from '../database/schema.js';
import { TeamOrderRepository } from '../repositories/teamOrderRepository.js';
import { WorkspaceRepository } from '../repositories/workspaceRepository.js';
import { ServiceError } from '../serviceError.js';

export class SystemService {
  readonly #orders: TeamOrderRepository;
  readonly #workspaces: WorkspaceRepository;
  constructor(private readonly db: Kysely<Database>) {
    this.#orders = new TeamOrderRepository(db);
    this.#workspaces = new WorkspaceRepository(db);
  }

  async teamOrders() {
    const [configuration, maintenances, orders] = await Promise.all([
      this.db.selectFrom('team_order_configurations').selectAll().orderBy('created_at').execute(),
      this.db.selectFrom('team_order_maintenances as m').innerJoin('workspaces as w', 'w.id', 'm.workspace_id')
        .innerJoin('accounts as a', 'a.id', 'm.executor_account_id')
        .selectAll('m').select(['w.name as workspace_name', 'w.external_id', 'a.email as executor_email']).orderBy('m.updated_at', 'desc').execute(),
      this.db.selectFrom('team_upgrade_orders as o').innerJoin('workspaces as w', 'w.id', 'o.workspace_id')
        .innerJoin('accounts as a', 'a.id', 'o.executor_account_id')
        .selectAll('o').select(['w.name as workspace_name', 'w.external_id', 'a.email as executor_email']).orderBy('o.created_at', 'desc').limit(100).execute()
    ]);
    return { configuration, maintenances, orders };
  }

  saveTeamOrderConfiguration(input: { workspaceId?: string; promoCode?: string; country?: string; currency?: string }) {
    return this.#orders.saveConfiguration(input.workspaceId ?? null, input);
  }

  async saveMaintenance(input: { workspaceId: string; executorAccountId: string; enabled: boolean; promoCode?: string; country?: string; currency?: string }) {
    await this.#workspaces.requireManageableBy(input.workspaceId, input.executorAccountId);
    await this.#orders.saveMaintenance({
      workspaceId: input.workspaceId,
      executorAccountId: input.executorAccountId,
      enabled: input.enabled,
      overrides: input
    });
  }

  async notificationPolicies() {
    return this.db.selectFrom('notification_policies').selectAll().orderBy('kind').execute();
  }

  async saveNotificationPolicy(kind: string, input: { enabled?: boolean; configuration?: Record<string, unknown> }) {
    const normalized = kind.trim();
    if (!normalized) throw new ServiceError(400, '通知策略类型不能为空');
    await this.db.insertInto('notification_policies').values({
      kind: normalized,
      enabled: input.enabled === true,
      configuration: input.configuration ?? {}
    }).onConflict((oc) => oc.column('kind').doUpdateSet({ enabled: input.enabled === true, configuration: input.configuration ?? {} })).execute();
    return this.notificationPolicies();
  }

  async overviewWorkspaces() {
    return this.db.selectFrom('workspaces as w').selectAll('w').select((eb) => [
      eb.selectFrom('workspace_memberships as m').select(({ fn }) => fn.countAll<number>().as('count')).whereRef('m.workspace_id', '=', 'w.id').where('m.status', '=', 'active').as('member_count'),
      eb.selectFrom('workspace_invitations as i').select(({ fn }) => fn.countAll<number>().as('count')).whereRef('i.workspace_id', '=', 'w.id').where('i.status', '=', 'pending').as('invitation_count'),
      eb.selectFrom('workspace_credentials as c').select(({ fn }) => fn.countAll<number>().as('count')).whereRef('c.workspace_id', '=', 'w.id').where('c.status', '=', 'active').as('credential_count')
    ]).orderBy('w.updated_at', 'desc').execute();
  }

  async overviewSeats() {
    return this.db.selectFrom('seat_slots as s').innerJoin('workspaces as w', 'w.id', 's.workspace_id')
      .selectAll('s').select(['w.name as workspace_name', 'w.external_id']).orderBy('s.expires_on').execute();
  }
}
