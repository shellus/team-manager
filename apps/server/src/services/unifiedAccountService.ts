import { sql, type Kysely } from 'kysely';
import {
  type AccountDeletionPreview,
  type AccountDeletionResult,
  parseChatGptSessionInput,
  type BulkUpdateAccountsRequest,
  type BulkUpdateAccountsResult,
  type ChatGptSessionInput,
  type UnifiedAccountDetailView,
  type UnifiedAccountSummaryView
} from '@team-manager/shared';
import type { Database } from '../database/schema.js';
import { normalizeEmail } from '../domain/identity.js';
import { AccountRepository, type AccountListFilters } from '../repositories/accountRepository.js';
import { AccountOperationalRepository } from '../repositories/accountOperationalRepository.js';
import { SessionRepository } from '../repositories/sessionRepository.js';
import { UnifiedProjectionRepository } from '../repositories/unifiedProjectionRepository.js';
import { ServiceError, asServiceError } from '../serviceError.js';
import { ActivityLogRepository } from '../repositories/activityLogRepository.js';
import type { ArtifactStore } from '../artifactStore.js';

export class UnifiedAccountService {
  readonly #accounts: AccountRepository;
  readonly #activity: ActivityLogRepository;
  constructor(
    private readonly db: Kysely<Database>,
    private readonly projections: UnifiedProjectionRepository,
    private readonly sessions: SessionRepository,
    private readonly operational: AccountOperationalRepository,
    private readonly artifacts: ArtifactStore
  ) {
    this.#accounts = new AccountRepository(db);
    this.#activity = new ActivityLogRepository(db);
  }

  list(filters: AccountListFilters): Promise<UnifiedAccountSummaryView[]> {
    return this.projections.accounts(filters);
  }

  registrations(filters: AccountListFilters) { return this.projections.registrations(filters); }

  groups() { return this.projections.groups(); }

  async detail(id: string): Promise<UnifiedAccountDetailView> {
    const result = await this.projections.account(id);
    if (!result) throw new ServiceError(404, '账号不存在');
    return result;
  }

  async create(input: {
    email?: unknown; groupId?: unknown; remark?: unknown; isBanned?: unknown;
    session?: unknown; proxy?: unknown;
  }): Promise<UnifiedAccountDetailView> {
    try {
      const parsed = input.session === undefined ? undefined : parseChatGptSessionInput(input.session);
      if (parsed && 'error' in parsed) throw new ServiceError(400, parsed.error);
      const email = string(input.email) || parsed?.user.email || '';
      if (!email) throw new ServiceError(400, '缺少账号邮箱或 Session');
      if (parsed && normalizeEmail(parsed.user.email) !== normalizeEmail(email)) {
        throw new ServiceError(409, 'Session 邮箱与账号邮箱不匹配');
      }
      const created = await this.#accounts.create({
        email,
        groupId: string(input.groupId) || undefined,
        remark: string(input.remark) || null,
        isBanned: input.isBanned === true,
        remotePersonalAccountId: parsed?.account.id ?? null
      });
      if (parsed) await this.saveSession(created.account.id, created.personalSpace.id, parsed, 'manual_create');
      const proxy = string(input.proxy);
      if (proxy) await this.operational.setProxy(created.account.id, proxy);
      await this.#activity.log({accountId:created.account.id,kind:'account_created',payload:{groupId:created.account.group_id,email:created.account.email,hasSession:Boolean(parsed)}});
      return this.detail(created.account.id);
    } catch (error) {
      throw asServiceError(error);
    }
  }

  async update(id: string, input: {
    groupId?: unknown; remark?: unknown; isBanned?: unknown;
    limitType?: unknown; proxy?: unknown; session?: unknown;
  }): Promise<UnifiedAccountDetailView> {
    try {
      const existing = await this.#accounts.findById(id);
      if (!existing) throw new ServiceError(404, '账号不存在');
      if (input.limitType !== undefined && !['unknown', 'weekly', 'monthly'].includes(String(input.limitType))) {
        throw new ServiceError(400, '无效的额度周期');
      }
      const parsedSession = input.session === undefined ? undefined : parseChatGptSessionInput(input.session);
      if (parsedSession && 'error' in parsedSession) throw new ServiceError(400, parsedSession.error);
      if (parsedSession && normalizeEmail(parsedSession.user.email) !== existing.normalized_email) {
        throw new ServiceError(409, 'Session 邮箱与账号邮箱不匹配');
      }
      await this.#accounts.update(id, {
        ...(typeof input.groupId === 'string' ? { groupId: input.groupId } : {}),
        ...(typeof input.remark === 'string' || input.remark === null ? { remark: input.remark } : {}),
        ...(typeof input.isBanned === 'boolean' ? { isBanned: input.isBanned } : {})
      });
      if (input.limitType !== undefined) {
        await this.operational.updateLimitType(id, input.limitType as 'unknown' | 'weekly' | 'monthly');
      }
      if (typeof input.proxy === 'string' || input.proxy === null) await this.operational.setProxy(id, input.proxy);
      if (parsedSession) {
        const personal = await this.db.selectFrom('personal_spaces').select('id').where('account_id', '=', id).executeTakeFirstOrThrow();
        await this.saveSession(id, personal.id, parsedSession, 'manual_replace');
      }
      await this.#activity.log({accountId:id,kind:'account_updated',payload:{fields:Object.keys(input)}});
      return this.detail(id);
    } catch (error) {
      throw asServiceError(error);
    }
  }

  async bulkUpdate(input: BulkUpdateAccountsRequest): Promise<BulkUpdateAccountsResult> {
    try {
      if (!input || !Array.isArray(input.accountIds)) throw new ServiceError(400, '账号列表无效');
      const accountIds = [...new Set(input.accountIds)];
      if (accountIds.length === 0) throw new ServiceError(400, '请至少选择一个账号');
      if (accountIds.some((id) => typeof id !== 'string' || !id.trim())) {
        throw new ServiceError(400, '账号列表无效');
      }
      if (accountIds.length > 10_000) throw new ServiceError(400, '单次批量操作最多支持 10000 个账号');

      const hasGroupUpdate = input.groupId !== undefined;
      const hasBannedUpdate = input.isBanned !== undefined;
      if (!hasGroupUpdate && !hasBannedUpdate) throw new ServiceError(400, '没有可更新的账号字段');
      if (hasGroupUpdate && (typeof input.groupId !== 'string' || !input.groupId.trim())) {
        throw new ServiceError(400, '目标分组无效');
      }
      if (hasBannedUpdate && typeof input.isBanned !== 'boolean') {
        throw new ServiceError(400, '封号状态无效');
      }

      await this.db.transaction().execute(async (trx) => {
        const existingAccounts = await trx.selectFrom('accounts').select('id').where('id', 'in', accountIds).execute();
        if (existingAccounts.length !== accountIds.length) throw new ServiceError(404, '部分账号不存在，请刷新后重试');

        if (hasGroupUpdate) {
          const group = await trx.selectFrom('account_groups').select('id').where('id', '=', input.groupId!).executeTakeFirst();
          if (!group) throw new ServiceError(404, '目标分组不存在，请刷新后重试');
        }

        const patch: { group_id?: string; is_banned?: boolean } = {};
        if (hasGroupUpdate) patch.group_id = input.groupId!;
        if (hasBannedUpdate) patch.is_banned = input.isBanned!;
        const result = await trx.updateTable('accounts').set(patch).where('id', 'in', accountIds).executeTakeFirst();
        if (Number(result.numUpdatedRows) !== accountIds.length) {
          throw new ServiceError(409, '账号批量更新未完整生效');
        }

        await new ActivityLogRepository(trx).log({
          kind: 'accounts_bulk_updated',
          payload: {
            accountIds,
            count: accountIds.length,
            ...(hasGroupUpdate ? { groupId: input.groupId } : {}),
            ...(hasBannedUpdate ? { isBanned: input.isBanned } : {})
          }
        });
      });
      return { updatedCount: accountIds.length };
    } catch (error) {
      throw asServiceError(error);
    }
  }

  async deletionPreview(id: string): Promise<AccountDeletionPreview> {
    try {
      const account = await this.db.selectFrom('accounts').select(['id', 'email']).where('id', '=', id).executeTakeFirst();
      if (!account) throw new ServiceError(404, '账号不存在');
      return await this.buildDeletionPreview(this.db, account);
    } catch (error) {
      throw asServiceError(error);
    }
  }

  async remove(id: string): Promise<AccountDeletionResult> {
    try {
      const deleted = await this.db.transaction().execute(async (trx) => {
        const account = await trx.selectFrom('accounts').select(['id', 'email'])
          .where('id', '=', id).forUpdate().executeTakeFirst();
        if (!account) throw new ServiceError(404, '账号不存在');

        const preview = await this.buildDeletionPreview(trx, account);
        const workspaceIds = preview.ownedWorkspaces.map((workspace) => workspace.id);
        const storageKeys = await this.selectCredentialStorageKeys(trx, id, workspaceIds);

        await this.deleteCascadeRows(trx, 'automation_operations', id, workspaceIds);
        await this.deleteCascadeRows(trx, 'team_upgrade_orders', id, workspaceIds, 'executor_account_id');
        await this.deleteCascadeRows(trx, 'team_order_maintenances', id, workspaceIds, 'executor_account_id');
        await this.deleteCascadeRows(trx, 'workspace_credentials', id, workspaceIds);
        await this.deleteWorkspaceRows(trx, 'seat_slots', workspaceIds);
        await this.deleteCascadeRows(trx, 'workspace_invitations', id, workspaceIds);
        await this.deleteCascadeRows(trx, 'workspace_memberships', id, workspaceIds);
        await this.deleteCascadeRows(trx, 'account_activity_logs', id, workspaceIds);
        if (workspaceIds.length) await trx.deleteFrom('workspaces').where('id', 'in', workspaceIds).execute();
        await trx.deleteFrom('accounts').where('id', '=', id).executeTakeFirstOrThrow();
        await new ActivityLogRepository(trx).log({
          kind: 'account_removed',
          payload: {
            accountId: id,
            email: account.email,
            deletedWorkspaceCount: preview.ownedWorkspaces.length,
            resources: preview.resources
          }
        });

        return { preview, storageKeys };
      });

      const artifactCleanup = await Promise.allSettled(
        deleted.storageKeys.map((storageKey) => this.artifacts.remove(storageKey))
      );
      return {
        deleted: true,
        deletedWorkspaceCount: deleted.preview.ownedWorkspaces.length,
        removedCredentialArtifactCount: artifactCleanup.filter((item) => item.status === 'fulfilled').length,
        credentialArtifactCleanupFailures: artifactCleanup.filter((item) => item.status === 'rejected').length
      };
    } catch (error) {
      throw asServiceError(error);
    }
  }

  private async buildDeletionPreview(
    db: Kysely<Database>,
    account: { id: string; email: string }
  ): Promise<AccountDeletionPreview> {
    const ownedRows = await db.selectFrom('workspace_memberships as membership')
      .innerJoin('workspaces as workspace', 'workspace.id', 'membership.workspace_id')
      .select(['workspace.id', 'workspace.external_id', 'workspace.name'])
      .where('membership.account_id', '=', account.id)
      .where('membership.status', '=', 'active')
      .where('membership.normalized_role', '=', 'owner')
      .execute();
    const workspaceIds = ownedRows.map((workspace) => workspace.id);
    const count = (
      table: 'workspace_memberships' | 'workspace_invitations' | 'workspace_credentials' | 'automation_operations' | 'team_order_maintenances' | 'team_upgrade_orders' | 'account_activity_logs',
      accountColumn: 'account_id' | 'executor_account_id' = 'account_id'
    ) => this.countCascadeRows(db, table, account.id, workspaceIds, accountColumn);
    const seatSlotCount = await this.countWorkspaceRows(db, 'seat_slots', workspaceIds);

    const ownedWorkspaces = await Promise.all(ownedRows.map(async (workspace) => ({
      id: workspace.id,
      ...(workspace.name ? { name: workspace.name } : {}),
      externalId: workspace.external_id,
      activeMembershipCount: (await db.selectFrom('workspace_memberships').select('id')
        .where('workspace_id', '=', workspace.id).where('status', '=', 'active').execute()).length,
      credentialCount: (await db.selectFrom('workspace_credentials').select('id')
        .where('workspace_id', '=', workspace.id).execute()).length,
      seatSlotCount: (await db.selectFrom('seat_slots').select('id')
        .where('workspace_id', '=', workspace.id).execute()).length,
      orderCount: (await db.selectFrom('team_upgrade_orders').select('id')
        .where('workspace_id', '=', workspace.id).execute()).length
    })));

    return {
      account,
      ownedWorkspaces,
      resources: {
        personalSpaces: (await db.selectFrom('personal_spaces').select('id').where('account_id', '=', account.id).execute()).length,
        sessionRecords: (await db.selectFrom('account_session_revisions').select('id').where('account_id', '=', account.id).execute()).length,
        accessContexts: (await db.selectFrom('account_access_contexts').select('id').where('account_id', '=', account.id).execute()).length,
        gamBindings: (await db.selectFrom('gam_bindings').select('id').where('account_id', '=', account.id).execute()).length,
        memberships: await count('workspace_memberships'),
        invitations: await count('workspace_invitations'),
        credentials: await count('workspace_credentials'),
        seatSlots: seatSlotCount,
        operations: await count('automation_operations'),
        maintenances: await count('team_order_maintenances', 'executor_account_id'),
        orders: await count('team_upgrade_orders', 'executor_account_id'),
        activityLogs: await count('account_activity_logs')
      },
      remoteWorkspaceDeletion: false
    };
  }

  private async countCascadeRows(
    db: Kysely<Database>,
    table: 'workspace_memberships' | 'workspace_invitations' | 'workspace_credentials' | 'automation_operations' | 'team_order_maintenances' | 'team_upgrade_orders' | 'account_activity_logs',
    accountId: string,
    workspaceIds: string[],
    accountColumn: 'account_id' | 'executor_account_id' = 'account_id'
  ): Promise<number> {
    const condition = workspaceIds.length
      ? sql`(${sql.ref(accountColumn)} = ${accountId} or ${sql.ref('workspace_id')} in (${sql.join(workspaceIds)}))`
      : sql`${sql.ref(accountColumn)} = ${accountId}`;
    const result = await sql<{ count: number }>`select count(*)::integer as count from ${sql.table(table)} where ${condition}`.execute(db);
    return result.rows[0]?.count ?? 0;
  }

  private async countWorkspaceRows(
    db: Kysely<Database>, table: 'seat_slots', workspaceIds: string[]
  ): Promise<number> {
    if (!workspaceIds.length) return 0;
    const result = await sql<{ count: number }>`
      select count(*)::integer as count from ${sql.table(table)}
      where workspace_id in (${sql.join(workspaceIds)})
    `.execute(db);
    return result.rows[0]?.count ?? 0;
  }

  private async selectCredentialStorageKeys(
    db: Kysely<Database>, accountId: string, workspaceIds: string[]
  ): Promise<string[]> {
    const condition = workspaceIds.length
      ? sql`(account_id = ${accountId} or workspace_id in (${sql.join(workspaceIds)}))`
      : sql`account_id = ${accountId}`;
    const result = await sql<{ storage_key: string }>`
      select storage_key from workspace_credentials where ${condition}
    `.execute(db);
    return result.rows.map((row) => row.storage_key);
  }

  private async deleteCascadeRows(
    db: Kysely<Database>,
    table: 'workspace_memberships' | 'workspace_invitations' | 'workspace_credentials' | 'automation_operations' | 'team_order_maintenances' | 'team_upgrade_orders' | 'account_activity_logs',
    accountId: string,
    workspaceIds: string[],
    accountColumn: 'account_id' | 'executor_account_id' = 'account_id'
  ): Promise<void> {
    const condition = workspaceIds.length
      ? sql`(${sql.ref(accountColumn)} = ${accountId} or ${sql.ref('workspace_id')} in (${sql.join(workspaceIds)}))`
      : sql`${sql.ref(accountColumn)} = ${accountId}`;
    await sql`delete from ${sql.table(table)} where ${condition}`.execute(db);
  }

  private async deleteWorkspaceRows(
    db: Kysely<Database>, table: 'seat_slots', workspaceIds: string[]
  ): Promise<void> {
    if (workspaceIds.length) await db.deleteFrom(table).where('workspace_id', 'in', workspaceIds).execute();
  }

  async session(id: string) {
    if (!await this.#accounts.findById(id)) throw new ServiceError(404, '账号不存在');
    const session = await this.sessions.currentSession(id);
    if (!session) throw new ServiceError(404, '账号没有 Session');
    return session;
  }

  async createGroup(name: string) {
    try { const group=await this.#accounts.createGroup(name);await this.#activity.log({kind:'account_group_created',payload:{groupId:group.id,name:group.name}}); return this.groups(); } catch (error) { throw asServiceError(error); }
  }
  async renameGroup(id: string, name: string) {
    try { const group=await this.#accounts.renameGroup(id, name);await this.#activity.log({kind:'account_group_renamed',payload:{groupId:id,name:group.name}}); return this.groups(); } catch (error) { throw asServiceError(error); }
  }
  async deleteGroup(id: string) {
    try { await this.#accounts.deleteGroup(id);await this.#activity.log({kind:'account_group_deleted',payload:{groupId:id}}); return this.groups(); } catch (error) { throw asServiceError(error); }
  }

  async reorderGroups(ids: string[]) {
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) throw new ServiceError(400, '分组排序无效');
    await this.db.transaction().execute(async (trx) => {
      const existing = await trx.selectFrom('account_groups').select('id').execute();
      if (existing.length !== ids.length || existing.some((row) => !ids.includes(row.id))) throw new ServiceError(409, '分组排序必须包含全部分组');
      for (const [sortOrder, id] of ids.entries()) await trx.updateTable('account_groups').set({ sort_order: sortOrder }).where('id', '=', id).execute();
    });
    await this.#activity.log({kind:'account_groups_reordered',payload:{ids}});
    return this.groups();
  }

  private async saveSession(accountId: string, personalSpaceId: string, session: ChatGptSessionInput, source: string): Promise<void> {
    await this.sessions.replaceCurrent({ accountId, personalSpaceId, session, source });
  }
}

function string(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
