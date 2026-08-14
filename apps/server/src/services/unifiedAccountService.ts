import type { Kysely } from 'kysely';
import {
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

export class UnifiedAccountService {
  readonly #accounts: AccountRepository;
  readonly #activity: ActivityLogRepository;
  constructor(
    private readonly db: Kysely<Database>,
    private readonly projections: UnifiedProjectionRepository,
    private readonly sessions: SessionRepository,
    private readonly operational: AccountOperationalRepository
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

  async remove(id: string): Promise<boolean> {
    try { const account=await this.#accounts.findById(id);if(!account)throw new ServiceError(404,'账号不存在');await this.#accounts.remove(id);await this.#activity.log({kind:'account_removed',payload:{accountId:id,email:account.email}}); return true; } catch (error) { throw asServiceError(error); }
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
    await this.sessions.saveRevision({
      accountId, session, source, observedEmail: session.user.email,
      observedPersonalAccountId: session.account.id
    });
    await this.sessions.saveAccessToken(accountId, { kind: 'personal', personalSpaceId }, session.accessToken, { status: 'unknown' });
    await this.sessions.invalidateWorkspaceAccessTokens(accountId);
  }
}

function string(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
