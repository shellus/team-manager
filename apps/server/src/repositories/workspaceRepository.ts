import { sql, type Kysely } from 'kysely';
import type { SeatType } from '@team-manager/shared';
import type { Database, WorkspaceMembershipRow, WorkspaceRow } from '../database/schema.js';
import { normalizeEmail } from '../domain/identity.js';

export interface UpsertWorkspaceInput {
  externalId: string;
  name?: string | null;
  status?: 'active' | 'inactive' | 'unknown';
  rawPlanCode?: string | null;
  normalizedPlan?: 'free' | 'business' | 'business_usage_based' | 'unknown';
  nextRenewalAt?: Date | string | null;
}

export interface UpsertMembershipInput {
  workspaceId: string;
  accountId?: string | null;
  remoteUserId?: string | null;
  email?: string | null;
  displayName?: string | null;
  rawRole?: string | null;
  normalizedRole: 'owner' | 'admin' | 'member' | 'analytics_viewer' | 'unknown';
  seatType?: SeatType | null;
  status?: 'active' | 'removed' | 'unknown';
  joinedAt?: Date | string | null;
  observedAt: Date | string;
  source: string;
}

export class WorkspaceRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async upsert(input: UpsertWorkspaceInput): Promise<WorkspaceRow> {
    const externalId = input.externalId.trim();
    if (!externalId) throw new Error('Workspace 外部 ID 不能为空');
    return this.db.insertInto('workspaces').values({
      external_id: externalId,
      name: input.name?.trim() || null,
      status: input.status ?? 'active',
      raw_plan_code: input.rawPlanCode ?? null,
      normalized_plan: input.normalizedPlan ?? 'unknown',
      next_renewal_at: input.nextRenewalAt ?? null
    }).onConflict((oc) => oc.column('external_id').doUpdateSet({
      name: input.name?.trim() || null,
      status: input.status ?? 'active',
      raw_plan_code: input.rawPlanCode ?? null,
      normalized_plan: input.normalizedPlan ?? 'unknown',
      next_renewal_at: input.nextRenewalAt ?? null
    })).returningAll().executeTakeFirstOrThrow();
  }

  async upsertMembership(input: UpsertMembershipInput): Promise<WorkspaceMembershipRow> {
    if (!input.accountId && !input.remoteUserId && !input.email) throw new Error('成员关系至少需要账号、远端用户 ID 或邮箱');
    const normalizedEmail = input.email ? normalizeEmail(input.email) : null;
    const existing = input.accountId
      ? await this.db.selectFrom('workspace_memberships').select('id').where('workspace_id', '=', input.workspaceId).where('account_id', '=', input.accountId).where('status', '=', 'active').executeTakeFirst()
      : input.remoteUserId
        ? await this.db.selectFrom('workspace_memberships').select('id').where('workspace_id', '=', input.workspaceId).where('remote_user_id', '=', input.remoteUserId).where('status', '=', 'active').executeTakeFirst()
        : await this.db.selectFrom('workspace_memberships').select('id').where('workspace_id', '=', input.workspaceId).where('normalized_email', '=', normalizedEmail).where('status', '=', 'active').executeTakeFirst();
    const values = {
      workspace_id: input.workspaceId,
      account_id: input.accountId ?? null,
      remote_user_id: input.remoteUserId ?? null,
      email: input.email?.trim() || null,
      normalized_email: normalizedEmail,
      display_name: input.displayName?.trim() || null,
      raw_role: input.rawRole ?? null,
      normalized_role: input.normalizedRole,
      seat_type: input.seatType ?? null,
      status: input.status ?? 'active',
      joined_at: input.joinedAt ?? null,
      observed_at: input.observedAt,
      source: input.source
    };
    if (existing) return this.db.updateTable('workspace_memberships').set(values).where('id', '=', existing.id).returningAll().executeTakeFirstOrThrow();
    return this.db.insertInto('workspace_memberships').values(values).returningAll().executeTakeFirstOrThrow();
  }

  listForAccount(accountId: string): Promise<Array<WorkspaceRow & { normalized_role: string; seat_type: string | null }>> {
    return this.db.selectFrom('workspaces as w')
      .innerJoin('workspace_memberships as wm', 'wm.workspace_id', 'w.id')
      .selectAll('w').select(['wm.normalized_role', 'wm.seat_type'])
      .where('wm.account_id', '=', accountId).where('wm.status', '=', 'active')
      .orderBy(sql`case when wm.normalized_role in ('owner', 'admin') then 0 else 1 end`).orderBy('w.name')
      .execute();
  }

  async requireManageableBy(workspaceId: string, accountId: string): Promise<void> {
    const row = await this.db.selectFrom('workspace_memberships as wm')
      .innerJoin('workspaces as w', 'w.id', 'wm.workspace_id')
      .select('wm.id')
      .where('wm.workspace_id', '=', workspaceId)
      .where('wm.account_id', '=', accountId)
      .where('wm.status', '=', 'active')
      .where('wm.normalized_role', 'in', ['owner', 'admin'])
      .where('w.status', '=', 'active')
      .executeTakeFirst();
    if (!row) throw new Error('所选账号没有管理该 Workspace 的权限');
  }

  findById(id: string): Promise<WorkspaceRow | undefined> {
    return this.db.selectFrom('workspaces').selectAll().where('id', '=', id).executeTakeFirst();
  }

  findByExternalId(externalId: string): Promise<WorkspaceRow | undefined> {
    return this.db.selectFrom('workspaces').selectAll().where('external_id', '=', externalId.trim()).executeTakeFirst();
  }
}
