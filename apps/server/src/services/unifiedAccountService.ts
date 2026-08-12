import type { Kysely } from 'kysely';
import {
  parseChatGptSessionInput,
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

export class UnifiedAccountService {
  readonly #accounts: AccountRepository;
  constructor(
    private readonly db: Kysely<Database>,
    private readonly projections: UnifiedProjectionRepository,
    private readonly sessions: SessionRepository,
    private readonly operational: AccountOperationalRepository
  ) {
    this.#accounts = new AccountRepository(db);
  }

  list(filters: AccountListFilters): Promise<UnifiedAccountSummaryView[]> {
    return this.projections.accounts(filters);
  }

  groups() { return this.projections.groups(); }

  async detail(id: string): Promise<UnifiedAccountDetailView> {
    const result = await this.projections.account(id);
    if (!result) throw new ServiceError(404, '账号不存在');
    return result;
  }

  async create(input: {
    email?: unknown; groupId?: unknown; remark?: unknown; isBanned?: unknown;
    session?: unknown; gamAccountRef?: unknown; proxy?: unknown;
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
      const gamAccountRef = string(input.gamAccountRef);
      if (gamAccountRef) await this.#accounts.bindGamAccount(created.account.id, gamAccountRef);
      const proxy = string(input.proxy);
      if (proxy) await this.operational.setProxy(created.account.id, proxy);
      return this.detail(created.account.id);
    } catch (error) {
      throw asServiceError(error);
    }
  }

  async update(id: string, input: {
    groupId?: unknown; remark?: unknown; isBanned?: unknown; displayName?: unknown;
    limitType?: unknown; proxy?: unknown; session?: unknown; gamAccountRef?: unknown;
  }): Promise<UnifiedAccountDetailView> {
    try {
      const existing = await this.#accounts.findById(id);
      if (!existing) throw new ServiceError(404, '账号不存在');
      await this.#accounts.update(id, {
        ...(typeof input.groupId === 'string' ? { groupId: input.groupId } : {}),
        ...(typeof input.remark === 'string' || input.remark === null ? { remark: input.remark } : {}),
        ...(typeof input.isBanned === 'boolean' ? { isBanned: input.isBanned } : {}),
        ...(typeof input.displayName === 'string' || input.displayName === null ? { displayName: input.displayName } : {})
      });
      if (input.limitType !== undefined) {
        if (!['unknown', 'weekly', 'monthly'].includes(String(input.limitType))) throw new ServiceError(400, '无效的额度周期');
        await this.operational.updateLimitType(id, input.limitType as 'unknown' | 'weekly' | 'monthly');
      }
      if (typeof input.proxy === 'string' || input.proxy === null) await this.operational.setProxy(id, input.proxy);
      if (typeof input.gamAccountRef === 'string' && input.gamAccountRef.trim()) await this.#accounts.bindGamAccount(id, input.gamAccountRef);
      if (input.session !== undefined) {
        const parsed = parseChatGptSessionInput(input.session);
        if ('error' in parsed) throw new ServiceError(400, parsed.error);
        if (normalizeEmail(parsed.user.email) !== existing.normalized_email) throw new ServiceError(409, 'Session 邮箱与账号邮箱不匹配');
        const personal = await this.db.selectFrom('personal_spaces').select('id').where('account_id', '=', id).executeTakeFirstOrThrow();
        await this.saveSession(id, personal.id, parsed, 'manual_replace');
      }
      return this.detail(id);
    } catch (error) {
      throw asServiceError(error);
    }
  }

  async remove(id: string): Promise<boolean> {
    try { await this.#accounts.remove(id); return true; } catch (error) { throw asServiceError(error); }
  }

  async createGroup(name: string) {
    try { await this.#accounts.createGroup(name); return this.groups(); } catch (error) { throw asServiceError(error); }
  }
  async renameGroup(id: string, name: string) {
    try { await this.#accounts.renameGroup(id, name); return this.groups(); } catch (error) { throw asServiceError(error); }
  }
  async deleteGroup(id: string) {
    try { await this.#accounts.deleteGroup(id); return this.groups(); } catch (error) { throw asServiceError(error); }
  }

  private async saveSession(accountId: string, personalSpaceId: string, session: ChatGptSessionInput, source: string): Promise<void> {
    await this.sessions.saveRevision({
      accountId, session, source, observedEmail: session.user.email,
      observedPersonalAccountId: session.account.id
    });
    await this.sessions.saveAccessToken(accountId, { kind: 'personal', personalSpaceId }, session.accessToken, { status: 'unknown' });
  }
}

function string(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
