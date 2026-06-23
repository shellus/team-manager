import type {
  Account,
  AccountFingerprint,
  AccountLimitType,
  AccountMemberProfile,
  AccountMemberProfileInput,
  AccountView,
  Member,
  PendingInvite,
  SeatType,
  InviteRequest
} from '@team-manager/shared';
import { parseChatGptSessionInput } from '@team-manager/shared';
import { BILLING_RISK_CONFIRM_MESSAGE, MAX_CHATGPT_SEATS } from '@team-manager/shared';
import { AccountStore } from './accountStore.js';
import {
  ChatGptApi,
  refreshAccessToken,
  tokenNeedsRefresh,
  type ChatGptAccountCheckEntry
} from './chatgptApi.js';
import { createTransport, type Transport } from './transport.js';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ACCOUNT_LIMIT_TYPES = new Set<AccountLimitType>(['unknown', 'weekly', 'monthly']);

/** 业务服务：封装母号 client 取用、token 惰性刷新、席位账单风险确认。 */
export class TeamService {
  constructor(
    private readonly store: AccountStore,
    private readonly transport: Transport = createTransport()
  ) {}

  /** 取母号并在 token 临过期时刷新（刷新后回写 store） */
  private async clientFor(id: string): Promise<{ account: Account; api: ChatGptApi }> {
    const account = this.store.get(id);
    if (!account) throw new ServiceError(404, `母号不存在: ${id}`);

    if (account.refreshToken && tokenNeedsRefresh(account.accessToken)) {
      try {
        const r = await refreshAccessToken(account.refreshToken);
        const updated = await this.store.update(id, {
          accessToken: r.accessToken,
          refreshToken: r.refreshToken ?? account.refreshToken,
          lastRefreshAt: Date.now(),
          lastError: undefined
        });
        if (updated) return { account: updated, api: new ChatGptApi(updated, this.transport) };
      } catch (e) {
        await this.store.update(id, { lastError: `刷新失败: ${(e as Error).message}` });
        // 刷新失败仍用旧 token 尝试（可能尚未真正过期）
      }
    }
    const fresh = this.store.get(id)!;
    return { account: fresh, api: new ChatGptApi(fresh, this.transport) };
  }

  private viewFromAccount(account: Account): AccountView {
    return {
      id: account.id,
      note: account.note,
      groupName: account.groupName || '默认分组',
      limitType: account.limitType ?? 'unknown',
      accountId: account.accountId,
      email: account.email,
      planType: account.planType,
      role: account.role,
      workspaceName: account.workspaceName,
      status: account.status ?? 'unknown',
      membersCache: account.membersCache,
      membersCachedAt: account.membersCachedAt,
      defaultSeat: account.defaultSeat,
      defaultSeatCachedAt: account.defaultSeatCachedAt,
      workspaceReferralsEnabled: account.workspaceReferralsEnabled,
      workspaceReferralsEnabledVisible: account.workspaceReferralsEnabledVisible,
      workspaceReferralsEnabledCachedAt: account.workspaceReferralsEnabledCachedAt,
      personalAccessTokensEnabled: account.personalAccessTokensEnabled,
      personalAccessTokensCachedAt: account.personalAccessTokensCachedAt,
      pendingInvitesCache: account.pendingInvitesCache,
      pendingInvitesCachedAt: account.pendingInvitesCachedAt,
      memberProfiles: account.memberProfiles,
      lastRefreshAt: account.lastRefreshAt,
      lastError: account.lastError
    };
  }

  /** 母号列表只读本地缓存，不触发 ChatGPT 慢请求。 */
  async listAccounts(): Promise<AccountView[]> {
    return this.store.list().map((account) => this.viewFromAccount(account));
  }

  async checkSessionAccounts(session: {
    accountId: string;
    accessToken: string;
    fp?: AccountFingerprint;
  }): Promise<ChatGptAccountCheckEntry[]> {
    return new ChatGptApi(session, this.transport).checkAccounts();
  }

  /** 慢速状态同步：显式调用，避免阻塞主页面列表。 */
  async refreshAccount(id: string): Promise<AccountView> {
    const account = this.store.get(id);
    if (!account) throw new ServiceError(404, `母号不存在: ${id}`);

    try {
      const { api } = await this.clientFor(id);
      const check = await api.checkAccount();
      const members = await api.listMembers();
      const now = Date.now();
      const updated = await this.store.update(id, {
        planType: check.planType ?? account.planType,
        role: check.role ?? account.role,
        workspaceName: check.workspaceName ?? account.workspaceName,
        membersCache: members,
        membersCachedAt: now,
        status: 'active',
        lastRefreshAt: now,
        lastError: undefined
      });
      return this.viewFromAccount(updated!);
    } catch (e) {
      const updated = await this.store.update(id, {
        status: 'invalid',
        lastRefreshAt: Date.now(),
        lastError: (e as Error).message
      });
      return this.viewFromAccount(updated!);
    }
  }

  async addAccount(input: Omit<Account, 'id'>): Promise<AccountView> {
    const account = await this.store.add(input);
    return this.viewFromAccount(account);
  }

  async updateLocalProfile(
    id: string,
    input: { note?: unknown; groupName?: unknown; limitType?: unknown; session?: unknown }
  ): Promise<AccountView> {
    const existing = this.store.get(id);
    if (!existing) throw new ServiceError(404, `母号不存在: ${id}`);

    const patch: Partial<Account> = { lastError: undefined };
    if (typeof input.note === 'string') patch.note = input.note.trim() || undefined;
    if (typeof input.groupName === 'string') {
      patch.groupName = input.groupName.trim() || '默认分组';
    }
    if (input.limitType !== undefined) {
      if (typeof input.limitType !== 'string' || !ACCOUNT_LIMIT_TYPES.has(input.limitType as AccountLimitType)) {
        throw new ServiceError(400, '限额类型无效');
      }
      patch.limitType = input.limitType as AccountLimitType;
    }

    if (input.session !== undefined) {
      const session = parseChatGptSessionInput(input.session);
      if ('error' in session) throw new ServiceError(400, session.error);
      patch.email = session.user.email;
      patch.accountId = session.account.id;
      patch.accessToken = session.accessToken;
      patch.status = 'unknown';
    }

    const updated = await this.store.update(id, patch);
    if (!updated) throw new ServiceError(404, `母号不存在: ${id}`);
    return this.viewFromAccount(updated);
  }

  async removeAccount(id: string): Promise<boolean> {
    return this.store.remove(id);
  }

  /** 成员列表默认读本地缓存，不触发 ChatGPT 慢请求。 */
  async listCachedMembers(id: string): Promise<Member[]> {
    const account = this.store.get(id);
    if (!account) throw new ServiceError(404, `母号不存在: ${id}`);
    return account.membersCache ?? [];
  }

  private async saveMemberCache(id: string, members: Member[]): Promise<Account> {
    const now = Date.now();
    const updated = await this.store.update(id, {
      membersCache: members,
      membersCachedAt: now,
      lastRefreshAt: now,
      lastError: undefined
    });
    if (!updated) throw new ServiceError(404, `母号不存在: ${id}`);
    return updated;
  }

  private async refreshMemberCache(id: string, api: ChatGptApi): Promise<Account> {
    return this.saveMemberCache(id, await api.listMembers());
  }

  /** 显式刷新成员列表，并把结果写回本地缓存。 */
  async refreshMembers(id: string): Promise<AccountView> {
    const { api } = await this.clientFor(id);
    return this.viewFromAccount(await this.refreshMemberCache(id, api));
  }

  /** 服务内部需要真实关系时仍显式走刷新。HTTP 默认接口不再调用它。 */
  async listMembers(id: string): Promise<Member[]> {
    const { api } = await this.clientFor(id);
    const updated = await this.refreshMemberCache(id, api);
    return updated.membersCache ?? [];
  }

  /** 邀请前实时统计远端 ChatGPT 席位（default）占用数。 */
  private async countRemoteChatgptSeats(api: ChatGptApi): Promise<number> {
    const members = await api.listMembers();
    return members.filter((m) => m.seat === 'default').length;
  }

  /** 邀请：若是 ChatGPT 席位且可能增加账单，要求调用方显式确认。 */
  async invite(id: string, req: InviteRequest): Promise<AccountView> {
    const { api } = await this.clientFor(id);
    const email = req.email.trim();
    if (!email) throw new ServiceError(400, '缺少邀请邮箱');
    if (req.seat === 'default') {
      const count = await this.countRemoteChatgptSeats(api);
      if (count >= MAX_CHATGPT_SEATS && !req.confirmBillingRisk) {
        throw new ServiceError(409, BILLING_RISK_CONFIRM_MESSAGE);
      }
    }
    await api.invite(email, req.seat, req.role);
    await this.refreshPendingInviteCache(id, api);
    return this.updateMemberProfile(id, email, req.memberProfile ?? {});
  }

  async updateMemberProfile(
    id: string,
    email: string,
    input: AccountMemberProfileInput
  ): Promise<AccountView> {
    const account = this.store.get(id);
    if (!account) throw new ServiceError(404, `母号不存在: ${id}`);

    const normalizedEmail = this.normalizeProfileEmail(email);
    const existingProfiles = account.memberProfiles ?? {};
    const nextProfile = this.buildMemberProfile(normalizedEmail, existingProfiles[normalizedEmail], input);
    const updated = await this.store.update(id, {
      memberProfiles: {
        ...existingProfiles,
        [normalizedEmail]: nextProfile
      },
      lastError: undefined
    });
    if (!updated) throw new ServiceError(404, `母号不存在: ${id}`);
    return this.viewFromAccount(updated);
  }

  private normalizeProfileEmail(email: string): string {
    const normalized = email.trim().toLowerCase();
    if (!normalized) throw new ServiceError(400, '缺少邮箱');
    return normalized;
  }

  private buildMemberProfile(
    email: string,
    existing: AccountMemberProfile | undefined,
    input: AccountMemberProfileInput
  ): AccountMemberProfile {
    const note = typeof input.note === 'string' ? input.note.trim() : existing?.note;
    const expiresOn = this.normalizeProfileDate(input.expiresOn, existing?.expiresOn);
    return {
      email,
      ...(note ? { note } : {}),
      expiresOn,
      expireRemove: typeof input.expireRemove === 'boolean' ? input.expireRemove : (existing?.expireRemove ?? false),
      expireReminder:
        typeof input.expireReminder === 'boolean' ? input.expireReminder : (existing?.expireReminder ?? true),
      updatedAt: Date.now()
    };
  }

  private normalizeProfileDate(value: string | undefined, fallback: string | undefined): string {
    if (value !== undefined) {
      const trimmed = value.trim();
      if (!DATE_ONLY_PATTERN.test(trimmed)) throw new ServiceError(400, '到期时间格式应为 yyyy-mm-dd');
      return trimmed;
    }
    if (fallback && DATE_ONLY_PATTERN.test(fallback)) return fallback;
    return localDateAfterDays(30);
  }

  async listCachedPendingInvites(id: string): Promise<PendingInvite[]> {
    const account = this.store.get(id);
    if (!account) throw new ServiceError(404, `母号不存在: ${id}`);
    return account.pendingInvitesCache ?? [];
  }

  async countCachedPendingInvites(id: string): Promise<number> {
    const account = this.store.get(id);
    if (!account) throw new ServiceError(404, `母号不存在: ${id}`);
    return account.pendingInvitesCache?.length ?? 0;
  }

  private async savePendingInviteCache(id: string, invites: PendingInvite[]): Promise<Account> {
    const now = Date.now();
    const updated = await this.store.update(id, {
      pendingInvitesCache: invites,
      pendingInvitesCachedAt: now,
      lastRefreshAt: now,
      lastError: undefined
    });
    if (!updated) throw new ServiceError(404, `母号不存在: ${id}`);
    return updated;
  }

  private async refreshPendingInviteCache(id: string, api: ChatGptApi): Promise<Account> {
    return this.savePendingInviteCache(id, await api.listPendingInvites());
  }

  async refreshPendingInvites(id: string): Promise<AccountView> {
    const { api } = await this.clientFor(id);
    return this.viewFromAccount(await this.refreshPendingInviteCache(id, api));
  }

  async listPendingInvites(id: string): Promise<PendingInvite[]> {
    const { api } = await this.clientFor(id);
    const updated = await this.refreshPendingInviteCache(id, api);
    return updated.pendingInvitesCache ?? [];
  }

  async countPendingInvites(id: string): Promise<number> {
    const { api } = await this.clientFor(id);
    return api.countPendingInvites();
  }

  async findEmailRelation(id: string, email: string): Promise<{ status: 'member' | 'invited' | 'unknown'; seat?: SeatType }> {
    const target = email.trim().toLowerCase();
    if (!target) throw new ServiceError(400, '缺少邮箱');

    const members = await this.listMembers(id);
    const member = members.find((item) => item.email.toLowerCase() === target);
    if (member) return { status: 'member', seat: member.seat };

    const invites = await this.listPendingInvites(id);
    const invite = invites.find((item) => item.email.toLowerCase() === target);
    if (invite) return { status: 'invited', seat: invite.seat };

    return { status: 'unknown' };
  }

  async revokePendingInvite(id: string, email: string): Promise<AccountView> {
    const trimmed = email.trim();
    if (!trimmed) throw new ServiceError(400, '缺少邀请邮箱');
    const { api } = await this.clientFor(id);
    await api.revokePendingInvite(trimmed);
    return this.viewFromAccount(await this.refreshPendingInviteCache(id, api));
  }

  async removeMember(id: string, userId: string): Promise<AccountView> {
    const { api } = await this.clientFor(id);
    await api.removeMember(userId);
    return this.viewFromAccount(await this.refreshMemberCache(id, api));
  }

  /** 改子号席位：升到 ChatGPT 席位且可能增加账单时要求调用方显式确认。 */
  async setMemberSeat(
    id: string,
    userId: string,
    seat: SeatType,
    confirmBillingRisk = false
  ): Promise<AccountView> {
    const { api } = await this.clientFor(id);
    const members = await api.listMembers();
    const target = members.find((m) => m.userId === userId);
    if (!target) throw new ServiceError(404, `成员不存在: ${userId}`);
    if (target.seat === seat) {
      return this.viewFromAccount(await this.saveMemberCache(id, members));
    }

    if (seat === 'default') {
      const currentDefault = members.filter((m) => m.seat === 'default').length;
      const projected = currentDefault + 1;
      if (projected > MAX_CHATGPT_SEATS && !confirmBillingRisk) {
        throw new ServiceError(409, BILLING_RISK_CONFIRM_MESSAGE);
      }
    }
    await api.setMemberSeat(userId, seat);
    return this.viewFromAccount(await this.refreshMemberCache(id, api));
  }

  async getCachedSettings(id: string): Promise<Record<string, unknown>> {
    const account = this.store.get(id);
    if (!account) throw new ServiceError(404, `母号不存在: ${id}`);
    return this.settingsFromAccount(account);
  }

  async refreshSettings(id: string): Promise<AccountView> {
    const { api } = await this.clientFor(id);
    const settings = await api.getSettings();
    const now = Date.now();
    const patch = this.settingsPatchFromResponse(settings, now);
    const updated = await this.store.update(id, patch);
    if (!updated) throw new ServiceError(404, `母号不存在: ${id}`);
    return this.viewFromAccount(updated);
  }

  async getSettings(id: string): Promise<Record<string, unknown>> {
    const view = await this.refreshSettings(id);
    return this.settingsFromAccount(view);
  }

  async setDefaultSeat(id: string, seat: SeatType): Promise<AccountView> {
    const { api } = await this.clientFor(id);
    const settings = await api.setDefaultSeat(seat);
    const now = Date.now();
    const updated = await this.store.update(id, this.settingsPatchFromResponse(settings, now, { defaultSeat: seat }));
    if (!updated) throw new ServiceError(404, `母号不存在: ${id}`);
    return this.viewFromAccount(updated);
  }

  async setWorkspaceReferralsEnabled(id: string, enabled: boolean): Promise<AccountView> {
    const { api } = await this.clientFor(id);
    const settings = await api.setWorkspaceReferralsEnabled(enabled);
    const now = Date.now();
    const updated = await this.store.update(
      id,
      this.settingsPatchFromResponse(settings, now, { workspaceReferralsEnabled: enabled })
    );
    if (!updated) throw new ServiceError(404, `母号不存在: ${id}`);
    return this.viewFromAccount(updated);
  }

  async setPersonalAccessTokensEnabled(id: string, enabled: boolean): Promise<AccountView> {
    const { api } = await this.clientFor(id);
    const settings = await api.setPersonalAccessTokensEnabled(enabled);
    const now = Date.now();
    const updated = await this.store.update(
      id,
      this.settingsPatchFromResponse(settings, now, { personalAccessTokensEnabled: enabled })
    );
    if (!updated) throw new ServiceError(404, `母号不存在: ${id}`);
    return this.viewFromAccount(updated);
  }

  private settingsFromAccount(
    account: Pick<
      Account,
      | 'defaultSeat'
      | 'workspaceReferralsEnabled'
      | 'workspaceReferralsEnabledVisible'
      | 'personalAccessTokensEnabled'
    >
  ): Record<string, unknown> {
    const settings: Record<string, unknown> = {};
    if (account.defaultSeat) settings.default_seat_type = account.defaultSeat;
    if (typeof account.workspaceReferralsEnabled === 'boolean') {
      settings.workspace_referrals_enabled = account.workspaceReferralsEnabled;
    }
    if (typeof account.workspaceReferralsEnabledVisible === 'boolean') {
      settings.workspace_referrals_enabled_visible = account.workspaceReferralsEnabledVisible;
    }
    if (typeof account.personalAccessTokensEnabled === 'boolean') {
      settings.personal_access_tokens = account.personalAccessTokensEnabled;
    }
    return settings;
  }

  private settingsPatchFromResponse(
    settings: Record<string, unknown>,
    now: number,
    fallback: {
      defaultSeat?: SeatType;
      workspaceReferralsEnabled?: boolean;
      personalAccessTokensEnabled?: boolean;
    } = {}
  ): Partial<Account> {
    const patch: Partial<Account> = {
      lastRefreshAt: now,
      lastError: undefined
    };

    const defaultSeat = settings.default_seat_type ?? fallback.defaultSeat;
    if (defaultSeat === 'default' || defaultSeat === 'usage_based') {
      patch.defaultSeat = defaultSeat;
      patch.defaultSeatCachedAt = now;
    }

    const workspaceReferralsEnabled =
      settings.workspace_referrals_enabled ?? fallback.workspaceReferralsEnabled;
    if (typeof workspaceReferralsEnabled === 'boolean') {
      patch.workspaceReferralsEnabled = workspaceReferralsEnabled;
      patch.workspaceReferralsEnabledCachedAt = now;
    }

    const workspaceReferralsEnabledVisible = settings.workspace_referrals_enabled_visible;
    if (typeof workspaceReferralsEnabledVisible === 'boolean') {
      patch.workspaceReferralsEnabledVisible = workspaceReferralsEnabledVisible;
    }

    const permissions = this.recordValue(settings.permissions);
    const personalAccessTokensEnabled =
      settings.personal_access_tokens ??
      permissions?.personal_access_tokens ??
      fallback.personalAccessTokensEnabled;
    if (typeof personalAccessTokensEnabled === 'boolean') {
      patch.personalAccessTokensEnabled = personalAccessTokensEnabled;
      patch.personalAccessTokensCachedAt = now;
    }

    return patch;
  }

  private recordValue(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    return value as Record<string, unknown>;
  }

  async renameTeam(id: string, name: string): Promise<AccountView> {
    const trimmed = name.trim();
    if (!trimmed) throw new ServiceError(400, '缺少 Team 名称');

    const { api } = await this.clientFor(id);
    await api.renameWorkspace(trimmed);
    const updated = await this.store.update(id, {
      workspaceName: trimmed,
      lastRefreshAt: Date.now(),
      lastError: undefined
    });
    if (!updated) throw new ServiceError(404, `母号不存在: ${id}`);
    return this.viewFromAccount(updated);
  }
}

function localDateAfterDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export class ServiceError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}
