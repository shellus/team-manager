import type {
  Account,
  AccountBillingSnapshot,
  AccountFingerprint,
  AccountLimitType,
  AccountSeatSlot,
  AccountSeatSlotProfileInput,
  AccountSeatSlotStatus,
  AccountView,
  ChatGptSessionInput,
  EditableMemberRole,
  Member,
  PendingInvite,
  PublicSeatSlotView,
  SeatType,
  InviteRequest,
  SeatSlotSwapState,
  SeatSlotSwapStep,
  SeatSlotSwapStepKey
} from '@team-manager/shared';
import {
  BILLING_RISK_CONFIRM_MESSAGE,
  MAX_CHATGPT_SEATS,
  MEMBER_OWNER_RISK_CONFIRM_MESSAGE
} from '@team-manager/shared';
import { randomBytes, randomUUID } from 'node:crypto';
import { AccountStore } from './accountStore.js';
import { AccountBillingStore } from './accountBillingStore.js';
import {
  ChatGptApi,
  ChatGptApiError,
  refreshAccessToken,
  tokenNeedsRefresh,
  type ChatGptAccountCheckEntry
} from './chatgptApi.js';
import {
  ChatGptWebSessionError,
  fetchWorkspaceWebAccessTokenFromSessionToken,
  resolveChatGptSessionImportInput
} from './chatgptWebSession.js';
import { createTransport, type Transport } from './transport.js';
import { workspaceSettingsFromCache, workspaceSettingsPatchFromResponse } from './workspaceSettings.js';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ACCOUNT_LIMIT_TYPES = new Set<AccountLimitType>(['unknown', 'weekly', 'monthly']);
const SEAT_KEY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function readableChatGptApiError(error: ChatGptApiError): string {
  try {
    const body = JSON.parse(error.body) as {
      detail?: unknown;
      error?: { message?: unknown };
    };
    if (typeof body.detail === 'string' && body.detail.trim()) return body.detail.trim();
    if (typeof body.error?.message === 'string' && body.error.message.trim()) {
      return body.error.message.trim();
    }
  } catch {
    // Fall through to the sanitized ChatGptApiError message.
  }
  return error.message;
}

interface ChatGptSessionClientInput {
  accountId: string;
  accessToken: string;
  fp?: AccountFingerprint;
  proxy?: string;
  sessionToken?: string;
  onAccessTokenRefreshed?: (accessToken: string) => Promise<void> | void;
}

/** 业务服务：封装母号 client 取用、token 惰性刷新、席位账单风险确认。 */
export class TeamService {
  private readonly seatSlotLocks = new Set<string>();

  constructor(
    private readonly store: AccountStore,
    private readonly transport: Transport = createTransport(),
    private readonly billingStore?: AccountBillingStore
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
        if (updated) return { account: updated, api: this.apiForAccount(updated) };
      } catch (e) {
        await this.store.update(id, { lastError: `刷新失败: ${(e as Error).message}` });
        // 刷新失败仍用旧 token 尝试（可能尚未真正过期）
      }
    }
    const fresh = this.store.get(id)!;
    return { account: fresh, api: this.apiForAccount(fresh) };
  }

  private apiForAccount(account: Account): ChatGptApi {
    return new ChatGptApi(
      {
        ...account,
        refreshWebAccessToken: account.sessionToken
          ? async () => {
              const accessToken = await this.fetchWorkspaceTokenFromSessionToken(
                account.sessionToken!,
                account.accountId,
                account.proxy
              );
              await this.store.update(account.id, {
                accessToken,
                lastRefreshAt: Date.now(),
                lastError: undefined
              });
              return accessToken;
            }
          : undefined
      },
      this.transport
    );
  }

  private viewFromAccount(account: Account): AccountView {
    return {
      id: account.id,
      remark: account.remark,
      groupName: account.groupName || '默认分组',
      limitType: account.limitType ?? 'unknown',
      accountId: account.accountId,
      email: account.email,
      proxy: account.proxy,
      session: {
        user: { email: account.email },
        account: { id: account.accountId },
        accessToken: account.accessToken,
        ...(account.sessionToken ? { sessionToken: account.sessionToken } : {})
      },
      planType: account.planType,
      role: account.role,
      workspaceName: account.workspaceName,
      nextRenewalOn: account.nextRenewalOn,
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
      codexLocalAccessEnabled: account.codexLocalAccessEnabled,
      codexLocalAccessCachedAt: account.codexLocalAccessCachedAt,
      codexDeviceCodeAuthEnabled: account.codexDeviceCodeAuthEnabled,
      codexDeviceCodeAuthCachedAt: account.codexDeviceCodeAuthCachedAt,
      codexRemoteControlEnabled: account.codexRemoteControlEnabled,
      codexRemoteControlCachedAt: account.codexRemoteControlCachedAt,
      pendingInvitesCache: account.pendingInvitesCache,
      pendingInvitesCachedAt: account.pendingInvitesCachedAt,
      seatSlots: account.seatSlots,
      lastRefreshAt: account.lastRefreshAt,
      lastError: account.lastError
    };
  }

  /** 母号列表只读本地缓存，不触发 ChatGPT 慢请求。 */
  async listAccounts(): Promise<AccountView[]> {
    return this.store.list().map((account) => this.viewFromAccount(account));
  }

  async getPublicSeatSlot(seatKey: string): Promise<PublicSeatSlotView> {
    const { slot } = this.findSeatSlotByKey(seatKey);
    return this.publicSeatSlotView(slot);
  }

  async swapPublicSeatSlotEmail(seatKey: string, email: string): Promise<PublicSeatSlotView> {
    const normalizedEmail = this.normalizeSeatSlotEmail(email);
    const found = this.findSeatSlotByKey(seatKey);
    if (found.account.seatSlots?.some((slot) => slot.seatKey !== seatKey && slot.email?.toLowerCase() === normalizedEmail)) {
      throw new ServiceError(409, '该邮箱已绑定到同一母号的其他席位');
    }
    if (this.seatSlotLocks.has(seatKey)) throw new ServiceError(409, '该席位正在换号，请稍后再试');

    this.seatSlotLocks.add(seatKey);
    try {
      return await this.runSeatSlotSwap(found.account.id, seatKey, normalizedEmail);
    } finally {
      this.seatSlotLocks.delete(seatKey);
    }
  }

  private async runSeatSlotSwap(accountId: string, seatKey: string, newEmail: string): Promise<PublicSeatSlotView> {
    const initial = this.findSeatSlotByKey(seatKey);
    const swap = this.createSeatSlotSwap(initial.slot.email, newEmail);
    await this.persistSeatSlotSwap(accountId, seatKey, swap);

    try {
      const { api } = await this.clientFor(accountId);
      this.markSeatSlotSwapStep(swap, 'refreshing_parent', 'running');
      await this.persistSeatSlotSwap(accountId, seatKey, swap);
      let members = await api.listMembers();
      let invites = await api.listPendingInvites();
      await this.saveMemberCache(accountId, members, { reconcileSeatSlots: false });
      await this.savePendingInviteCache(accountId, invites, { reconcileSeatSlots: false });
      await this.refreshSeatSlotRelation(accountId, seatKey, members, invites);
      this.markSeatSlotSwapStep(swap, 'refreshing_parent', 'done');

      const current = this.findSeatSlotByKey(seatKey).slot;
      this.markSeatSlotSwapStep(swap, 'confirming_current_email', 'running');
      await this.persistSeatSlotSwap(accountId, seatKey, swap);
      const currentEmail = current.email?.toLowerCase();
      const currentMember = currentEmail ? members.find((member) => member.email.toLowerCase() === currentEmail) : undefined;
      const currentInvite = currentEmail ? invites.find((invite) => invite.email.toLowerCase() === currentEmail) : undefined;
      this.markSeatSlotSwapStep(
        swap,
        'confirming_current_email',
        'done',
        currentEmail ? `当前邮箱 ${currentEmail}` : '当前席位为空'
      );

      if (currentMember) {
        if (currentMember.role === 'account-owner' || currentMember.role === 'account-admin') {
          throw new ServiceError(409, '席位当前邮箱是 owner/admin，拒绝通过自助页移除');
        }
        this.markSeatSlotSwapStep(swap, 'removing_current_member', 'running', currentMember.email);
        await this.persistSeatSlotSwap(accountId, seatKey, swap);
        await api.removeMember(currentMember.userId);
        this.markSeatSlotSwapStep(swap, 'removing_current_member', 'done', currentMember.email);
      } else {
        this.markSeatSlotSwapStep(swap, 'removing_current_member', 'skipped', '当前邮箱不是成员');
      }

      if (!currentMember && currentInvite) {
        this.markSeatSlotSwapStep(swap, 'revoking_current_invite', 'running', currentInvite.email);
        await this.persistSeatSlotSwap(accountId, seatKey, swap);
        await api.revokePendingInvite(currentInvite.email);
        this.markSeatSlotSwapStep(swap, 'revoking_current_invite', 'done', currentInvite.email);
      } else {
        this.markSeatSlotSwapStep(swap, 'revoking_current_invite', 'skipped', currentMember ? '已移除成员' : '当前邮箱不是邀请');
      }

      this.markSeatSlotSwapStep(swap, 'inviting_new_email', 'running', newEmail);
      await this.persistSeatSlotSwap(accountId, seatKey, swap);
      await api.invite(newEmail, 'default', 'standard-user');
      this.markSeatSlotSwapStep(swap, 'inviting_new_email', 'done', newEmail);

      this.markSeatSlotSwapStep(swap, 'saving_new_profile', 'running', newEmail);
      await this.patchSeatSlot(accountId, seatKey, (slot) => ({
        ...slot,
        email: newEmail,
        status: 'unknown',
        currentUserId: undefined,
        currentInviteId: undefined,
        lastSwap: swap,
        updatedAt: Date.now()
      }));
      this.markSeatSlotSwapStep(swap, 'saving_new_profile', 'done', newEmail);

      this.markSeatSlotSwapStep(swap, 'refreshing_final_state', 'running');
      await this.persistSeatSlotSwap(accountId, seatKey, swap);
      members = await api.listMembers();
      invites = await api.listPendingInvites();
      await this.saveMemberCache(accountId, members, { reconcileSeatSlots: false });
      await this.savePendingInviteCache(accountId, invites, { reconcileSeatSlots: false });
      await this.refreshSeatSlotRelation(accountId, seatKey, members, invites);
      this.markSeatSlotSwapStep(swap, 'refreshing_final_state', 'done');

      swap.status = 'succeeded';
      swap.completedAt = Date.now();
      swap.updatedAt = swap.completedAt;
      await this.persistSeatSlotSwap(accountId, seatKey, swap);
      return this.publicSeatSlotView(this.findSeatSlotByKey(seatKey).slot);
    } catch (error) {
      swap.status = 'failed';
      swap.error = (error as Error).message;
      swap.completedAt = Date.now();
      swap.updatedAt = swap.completedAt;
      const running = swap.steps.find((step) => step.status === 'running');
      if (running) {
        running.status = 'failed';
        running.message = swap.error;
        running.at = swap.completedAt;
      }
      await this.persistSeatSlotSwap(accountId, seatKey, swap).catch(() => undefined);
      throw error;
    }
  }

  private findSeatSlotByKey(seatKey: string): { account: Account; slot: AccountSeatSlot; index: number } {
    const normalized = seatKey.trim();
    for (const account of this.store.list()) {
      const index = account.seatSlots?.findIndex((slot) => slot.seatKey === normalized) ?? -1;
      if (index >= 0 && account.seatSlots) return { account, slot: account.seatSlots[index]!, index };
    }
    throw new ServiceError(404, '席位不存在');
  }

  private publicSeatSlotView(slot: AccountSeatSlot): PublicSeatSlotView {
    const swapHistory = this.seatSlotSwapHistory(slot);
    return {
      seatKey: slot.seatKey,
      ...(slot.email ? { email: slot.email } : {}),
      ...(slot.remark ? { remark: slot.remark } : {}),
      expiresOn: slot.expiresOn,
      ...(slot.price ? { price: slot.price } : {}),
      status: slot.status ?? 'unknown',
      ...(slot.lastSwap ? { swap: slot.lastSwap } : {}),
      ...(swapHistory.length ? { swapHistory } : {})
    };
  }

  private createSeatSlotSwap(fromEmail: string | undefined, toEmail: string): SeatSlotSwapState {
    const now = Date.now();
    return {
      id: randomUUID(),
      status: 'running',
      ...(fromEmail ? { fromEmail } : {}),
      toEmail,
      startedAt: now,
      updatedAt: now,
      steps: [
        this.createSeatSlotSwapStep('refreshing_parent', '正在同步母号信息'),
        this.createSeatSlotSwapStep('confirming_current_email', '确认要移除的成员'),
        this.createSeatSlotSwapStep('removing_current_member', '正在移除当前成员'),
        this.createSeatSlotSwapStep('revoking_current_invite', '正在撤销当前邀请'),
        this.createSeatSlotSwapStep('inviting_new_email', '正在添加新成员'),
        this.createSeatSlotSwapStep('saving_new_profile', '正在设置新席位资料'),
        this.createSeatSlotSwapStep('refreshing_final_state', '正在刷新最终状态')
      ]
    };
  }

  private createSeatSlotSwapStep(key: SeatSlotSwapStepKey, label: string): SeatSlotSwapStep {
    return { key, label, status: 'pending' };
  }

  private markSeatSlotSwapStep(
    swap: SeatSlotSwapState,
    key: SeatSlotSwapStepKey,
    status: SeatSlotSwapStep['status'],
    message?: string
  ): void {
    const step = swap.steps.find((item) => item.key === key);
    if (!step) return;
    step.status = status;
    step.at = Date.now();
    if (message) step.message = message;
    swap.updatedAt = step.at;
  }

  private async persistSeatSlotSwap(accountId: string, seatKey: string, swap: SeatSlotSwapState): Promise<AccountSeatSlot> {
    return this.patchSeatSlot(accountId, seatKey, (slot) => ({
      ...slot,
      lastSwap: swap,
      swapHistory: this.upsertSeatSlotSwapHistory(slot, swap),
      updatedAt: Date.now()
    }));
  }

  private upsertSeatSlotSwapHistory(slot: AccountSeatSlot, swap: SeatSlotSwapState): SeatSlotSwapState[] {
    const history = this.seatSlotSwapHistory(slot);
    const existingIndex = history.findIndex((item) => item.id === swap.id);
    if (existingIndex >= 0) {
      history[existingIndex] = swap;
    } else {
      history.push(swap);
    }
    return history;
  }

  private seatSlotSwapHistory(slot: AccountSeatSlot): SeatSlotSwapState[] {
    const history = [...(slot.swapHistory ?? [])];
    if (slot.lastSwap && !history.some((swap) => swap.id === slot.lastSwap?.id)) {
      history.push(slot.lastSwap);
    }
    return history;
  }

  private async patchSeatSlot(
    accountId: string,
    seatKey: string,
    patch: (slot: AccountSeatSlot) => AccountSeatSlot
  ): Promise<AccountSeatSlot> {
    const account = this.store.get(accountId);
    if (!account?.seatSlots) throw new ServiceError(404, '席位不存在');
    const index = account.seatSlots.findIndex((slot) => slot.seatKey === seatKey);
    if (index < 0) throw new ServiceError(404, '席位不存在');
    const nextSlots = account.seatSlots.map((slot, slotIndex) => (slotIndex === index ? patch(slot) : slot));
    const updated = await this.store.update(accountId, { seatSlots: nextSlots, lastError: undefined });
    const nextSlot = updated?.seatSlots?.find((slot) => slot.seatKey === seatKey);
    if (!nextSlot) throw new ServiceError(404, '席位不存在');
    return nextSlot;
  }

  private async refreshSeatSlotRelation(
    accountId: string,
    seatKey: string,
    members: Member[],
    invites: PendingInvite[]
  ): Promise<AccountSeatSlot> {
    const slot = this.findSeatSlotByKey(seatKey).slot;
    const relation = this.seatSlotRelation(slot.email, members, invites);
    return this.patchSeatSlot(accountId, seatKey, (current) => ({
      ...current,
      status: relation.status,
      currentUserId: relation.currentUserId,
      currentInviteId: relation.currentInviteId,
      updatedAt: Date.now()
    }));
  }

  private seatSlotRelation(
    email: string | undefined,
    members: Member[],
    invites: PendingInvite[]
  ): { status: AccountSeatSlotStatus; currentUserId?: string; currentInviteId?: string } {
    const target = email?.trim().toLowerCase();
    if (!target) return { status: 'empty' };
    const member = members.find((item) => item.seat === 'default' && item.email.toLowerCase() === target);
    if (member) return { status: 'member', currentUserId: member.userId };
    const invite = invites.find((item) => item.seat === 'default' && item.email.toLowerCase() === target);
    if (invite) return { status: 'invited', currentInviteId: invite.inviteId };
    return { status: 'unknown' };
  }

  private reconcileSeatSlots(
    account: Account,
    members: Member[] | undefined,
    invites: PendingInvite[] | undefined
  ): Account['seatSlots'] {
    if (!account.seatSlots || !members || !invites) return account.seatSlots;

    const relationByEmail = new Map<
      string,
      { status: AccountSeatSlotStatus; currentUserId?: string; currentInviteId?: string }
    >();
    for (const member of members) {
      if (member.seat !== 'default') continue;
      relationByEmail.set(member.email.toLowerCase(), { status: 'member', currentUserId: member.userId });
    }
    for (const invite of invites) {
      if (invite.seat !== 'default') continue;
      const email = invite.email.toLowerCase();
      if (!relationByEmail.has(email)) {
        relationByEmail.set(email, { status: 'invited', currentInviteId: invite.inviteId });
      }
    }

    const now = Date.now();
    const nextSlots: AccountSeatSlot[] = [];
    for (const slot of account.seatSlots) {
      const email = slot.email?.toLowerCase();
      const relation = email ? relationByEmail.get(email) : undefined;
      if (!relation) continue;
      nextSlots.push({
        ...slot,
        status: relation.status,
        currentUserId: relation.currentUserId,
        currentInviteId: relation.currentInviteId,
        updatedAt: this.seatSlotRelationChanged(slot, relation) ? now : slot.updatedAt
      });
    }

    return nextSlots.length > 0 ? nextSlots : undefined;
  }

  private seatSlotRelationChanged(
    slot: AccountSeatSlot,
    relation: { status: AccountSeatSlotStatus; currentUserId?: string; currentInviteId?: string }
  ): boolean {
    return (
      slot.status !== relation.status ||
      slot.currentUserId !== relation.currentUserId ||
      slot.currentInviteId !== relation.currentInviteId
    );
  }

  async checkSessionAccounts(session: {
    accountId: string;
    accessToken: string;
    fp?: AccountFingerprint;
    proxy?: string;
    sessionToken?: string;
    onAccessTokenRefreshed?: (accessToken: string) => Promise<void> | void;
  }): Promise<ChatGptAccountCheckEntry[]> {
    return this.apiForSession(session).checkAccounts();
  }

  async findSessionEmailRelation(
    session: {
      accountId: string;
      accessToken: string;
      fp?: AccountFingerprint;
      proxy?: string;
      sessionToken?: string;
      onAccessTokenRefreshed?: (accessToken: string) => Promise<void> | void;
    },
    email: string
  ): Promise<{ status: 'member' | 'unknown'; seat?: SeatType }> {
    const member = await this.apiForSession(session).findMemberByEmail(email);
    if (!member) return { status: 'unknown' };
    return { status: 'member', seat: member.seat };
  }

  async removeSessionMember(
    session: {
      accountId: string;
      accessToken: string;
      fp?: AccountFingerprint;
      proxy?: string;
      sessionToken?: string;
      onAccessTokenRefreshed?: (accessToken: string) => Promise<void> | void;
    },
    userId: string
  ): Promise<void> {
    const target = userId.trim();
    if (!target) throw new ServiceError(400, '缺少用户 ID');
    await this.apiForSession(session).removeMember(target);
  }

  async requestSessionWorkspaceInvite(
    session: {
      accountId: string;
      accessToken: string;
      fp?: AccountFingerprint;
      proxy?: string;
      sessionToken?: string;
      onAccessTokenRefreshed?: (accessToken: string) => Promise<void> | void;
    },
    workspaceId: string
  ): Promise<void> {
    const target = workspaceId.trim();
    if (!target) throw new ServiceError(400, '缺少 workspace ID');
    await this.apiForSession(session).requestWorkspaceInvite(target);
  }

  private apiForSession(session: ChatGptSessionClientInput): ChatGptApi {
    return new ChatGptApi(
      {
        accountId: session.accountId,
        accessToken: session.accessToken,
        fp: session.fp,
        proxy: session.proxy,
        refreshWebAccessToken: session.sessionToken
          ? async () => {
              const accessToken = await this.fetchWorkspaceTokenFromSessionToken(
                session.sessionToken!,
                session.accountId,
                session.proxy
              );
              await session.onAccessTokenRefreshed?.(accessToken);
              return accessToken;
            }
          : undefined
      },
      this.transport
    );
  }

  /** 慢速状态同步：显式调用，避免阻塞主页面列表。 */
  async refreshAccount(id: string): Promise<AccountView> {
    const account = this.store.get(id);
    if (!account) throw new ServiceError(404, `母号不存在: ${id}`);

    try {
      const { api } = await this.clientFor(id);
      const check = await api.checkAccount();
      const members = await api.listMembers();
      const pendingInvites = await api.listPendingInvites();
      const now = Date.now();
      const updated = await this.store.update(id, {
        planType: check.planType ?? account.planType,
        role: check.role ?? account.role,
        workspaceName: check.workspaceName ?? account.workspaceName,
        nextRenewalOn: check.nextRenewalOn ?? account.nextRenewalOn,
        membersCache: members,
        membersCachedAt: now,
        pendingInvitesCache: pendingInvites,
        pendingInvitesCachedAt: now,
        seatSlots: this.reconcileSeatSlots(account, members, pendingInvites),
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

  async addAccountFromSessionInput(raw: unknown): Promise<AccountView> {
    const createInput = this.parseParentAccountCreateInput(raw);
    const localFields = this.normalizeParentLocalProfileFields(createInput);
    const input = await this.resolveParentWorkspaceSession(createInput.session, undefined, localFields.proxy);
    return this.addAccount({
      remark: localFields.remark,
      groupName: localFields.groupName ?? '默认分组',
      limitType: localFields.limitType ?? 'unknown',
      accountId: input.session.account.id,
      email: input.session.user.email,
      accessToken: input.session.accessToken,
      sessionToken: input.session.sessionToken,
      proxy: localFields.proxy,
      planType: input.workspace.planType,
      role: input.workspace.role,
      workspaceName: input.workspace.workspaceName,
      nextRenewalOn: input.workspace.nextRenewalOn ?? localFields.nextRenewalOn,
      status: 'unknown'
    });
  }

  private parseParentAccountCreateInput(raw: unknown): {
    remark?: unknown;
    groupName?: unknown;
    limitType?: unknown;
    nextRenewalOn?: unknown;
    proxy?: unknown;
    session: unknown;
  } {
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && Object.prototype.hasOwnProperty.call(raw, 'session')) {
      const record = raw as Record<string, unknown>;
      return {
        remark: record.remark,
        groupName: record.groupName,
        limitType: record.limitType,
        nextRenewalOn: record.nextRenewalOn,
        proxy: record.proxy,
        session: record.session
      };
    }
    return { session: raw };
  }

  private normalizeParentLocalProfileFields(input: {
    remark?: unknown;
    groupName?: unknown;
    limitType?: unknown;
    nextRenewalOn?: unknown;
    proxy?: unknown;
  }): Partial<Account> {
    const patch: Partial<Account> = {};
    if (typeof input.remark === 'string') patch.remark = input.remark.trim() || undefined;
    if (typeof input.groupName === 'string') {
      patch.groupName = input.groupName.trim() || '默认分组';
    }
    if (input.limitType !== undefined) {
      if (typeof input.limitType !== 'string' || !ACCOUNT_LIMIT_TYPES.has(input.limitType as AccountLimitType)) {
        throw new ServiceError(400, '限额类型无效');
      }
      patch.limitType = input.limitType as AccountLimitType;
    }
    if (input.nextRenewalOn !== undefined) {
      patch.nextRenewalOn = this.normalizeOptionalDate(input.nextRenewalOn, '下次续费时间');
    }
    if (input.proxy !== undefined) {
      if (typeof input.proxy !== 'string') throw new ServiceError(400, '代理地址必须是字符串');
      patch.proxy = input.proxy.trim() || undefined;
    }
    return patch;
  }

  async updateLocalProfile(
    id: string,
    input: {
      remark?: unknown;
      groupName?: unknown;
      limitType?: unknown;
      nextRenewalOn?: unknown;
      proxy?: unknown;
      session?: unknown;
    }
  ): Promise<AccountView> {
    const existing = this.store.get(id);
    if (!existing) throw new ServiceError(404, `母号不存在: ${id}`);

    const patch: Partial<Account> = {
      ...this.normalizeParentLocalProfileFields(input),
      lastError: undefined
    };

    if (input.session !== undefined) {
      const proxy = Object.prototype.hasOwnProperty.call(patch, 'proxy') ? patch.proxy : existing.proxy;
      const { session, workspace } = await this.resolveParentWorkspaceSession(input.session, existing.accountId, proxy);
      patch.email = session.user.email;
      patch.accountId = session.account.id;
      patch.accessToken = session.accessToken;
      patch.sessionToken = session.sessionToken;
      patch.planType = workspace.planType;
      patch.role = workspace.role;
      patch.workspaceName = workspace.workspaceName;
      patch.nextRenewalOn = workspace.nextRenewalOn;
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

  private async saveMemberCache(
    id: string,
    members: Member[],
    options: { reconcileSeatSlots?: boolean } = {}
  ): Promise<Account> {
    const account = this.store.get(id);
    if (!account) throw new ServiceError(404, `母号不存在: ${id}`);
    const now = Date.now();
    const patch: Partial<Account> = {
      membersCache: members,
      membersCachedAt: now,
      lastRefreshAt: now,
      lastError: undefined
    };
    if (options.reconcileSeatSlots !== false) {
      patch.seatSlots = this.reconcileSeatSlots(account, members, account.pendingInvitesCache);
    }
    const updated = await this.store.update(id, patch);
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
    const updated = await this.refreshPendingInviteCache(id, api);
    if (req.seat !== 'default') return this.viewFromAccount(updated);
    return this.updateSeatSlotProfile(id, email, req.seatSlotProfile ?? {});
  }

  async updateSeatSlotProfile(
    id: string,
    email: string,
    input: AccountSeatSlotProfileInput
  ): Promise<AccountView> {
    const account = this.store.get(id);
    if (!account) throw new ServiceError(404, `母号不存在: ${id}`);

    const normalizedEmail = this.normalizeSeatSlotEmail(email);
    const existingSlots = account.seatSlots ?? [];
    const existingSlot = existingSlots.find((slot) => slot.email?.toLowerCase() === normalizedEmail);
    const usedKeys = new Set(existingSlots.map((slot) => slot.seatKey));
    const relation = this.seatSlotRelation(normalizedEmail, account.membersCache ?? [], account.pendingInvitesCache ?? []);
    if (!existingSlot && relation.status === 'unknown') {
      throw new ServiceError(409, '无法保存席位资料：该邮箱不是当前 Team 的 ChatGPT 固定席位');
    }
    const nextSlot = this.buildSeatSlotProfile(normalizedEmail, existingSlot, input, relation, usedKeys);
    const nextSlots = existingSlot
      ? existingSlots.map((slot) => (slot.seatKey === existingSlot.seatKey ? nextSlot : slot))
      : [...existingSlots, nextSlot];
    const updated = await this.store.update(id, {
      seatSlots: nextSlots,
      lastError: undefined
    });
    if (!updated) throw new ServiceError(404, `母号不存在: ${id}`);
    return this.viewFromAccount(updated);
  }

  private normalizeSeatSlotEmail(email: string): string {
    const normalized = email.trim().toLowerCase();
    if (!normalized) throw new ServiceError(400, '缺少邮箱');
    return normalized;
  }

  private buildSeatSlotProfile(
    email: string,
    existing: AccountSeatSlot | undefined,
    input: AccountSeatSlotProfileInput,
    relation: { status: AccountSeatSlotStatus; currentUserId?: string; currentInviteId?: string },
    usedKeys: Set<string>
  ): AccountSeatSlot {
    const remark = typeof input.remark === 'string' ? input.remark.trim() : existing?.remark;
    const expiresOn = this.normalizeProfileDate(input.expiresOn, existing?.expiresOn);
    return {
      seatKey: existing?.seatKey ?? this.generateSeatKey(usedKeys),
      email,
      ...(remark ? { remark } : {}),
      expiresOn,
      ...(existing?.price ? { price: existing.price } : {}),
      seat: 'default',
      status: relation.status,
      ...(relation.currentUserId ? { currentUserId: relation.currentUserId } : {}),
      ...(relation.currentInviteId ? { currentInviteId: relation.currentInviteId } : {}),
      expireRemove: typeof input.expireRemove === 'boolean' ? input.expireRemove : (existing?.expireRemove ?? false),
      expireReminder:
        typeof input.expireReminder === 'boolean' ? input.expireReminder : (existing?.expireReminder ?? true),
      lastSwap: existing?.lastSwap,
      ...(existing?.swapHistory ? { swapHistory: existing.swapHistory } : {}),
      updatedAt: Date.now()
    };
  }

  private generateSeatKey(usedKeys: Set<string>): string {
    for (;;) {
      const bytes = randomBytes(16);
      let key = '';
      for (const byte of bytes) key += SEAT_KEY_ALPHABET[byte % SEAT_KEY_ALPHABET.length];
      if (!usedKeys.has(key)) {
        usedKeys.add(key);
        return key;
      }
    }
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

  private normalizeOptionalDate(value: unknown, label: string): string | undefined {
    if (typeof value !== 'string') throw new ServiceError(400, `${label}格式应为 yyyy-mm-dd`);
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (!DATE_ONLY_PATTERN.test(trimmed)) throw new ServiceError(400, `${label}格式应为 yyyy-mm-dd`);
    return trimmed;
  }

  private async resolveAccountSessionInput(
    raw: unknown
  ): Promise<Awaited<ReturnType<typeof resolveChatGptSessionImportInput>>> {
    try {
      return await resolveChatGptSessionImportInput(raw, this.transport);
    } catch (e) {
      if (e instanceof ChatGptWebSessionError) throw new ServiceError(e.status, e.message);
      throw e;
    }
  }

  private async resolveParentWorkspaceSession(
    raw: unknown,
    preferredAccountId?: string,
    proxy?: string
  ): Promise<{ type: 'workspace_session'; session: ChatGptSessionInput; workspace: ChatGptAccountCheckEntry }> {
    const input = await this.resolveAccountSessionInput(raw);
    const sessionToken = input.session.sessionToken;
    const sessionContext = {
      accountId: input.session.account.id,
      accessToken: input.session.accessToken,
      proxy,
      refreshWebAccessToken: sessionToken
        ? () => this.fetchWorkspaceTokenFromSessionToken(sessionToken, input.session.account.id, proxy)
        : undefined
    };
    const workspaces = await new ChatGptApi(sessionContext, this.transport).checkAccounts();
    const currentSession = { ...input.session, accessToken: sessionContext.accessToken };
    const workspace = this.selectParentWorkspace(workspaces, input.session.account.id, preferredAccountId);
    const accessToken = await this.resolveWebAccessTokenForWorkspace(currentSession, workspace.accountId, proxy);
    return {
      type: input.type,
      workspace,
      session: {
        ...input.session,
        account: { id: workspace.accountId },
        accessToken
      }
    };
  }

  private selectParentWorkspace(
    workspaces: ChatGptAccountCheckEntry[],
    sessionAccountId: string,
    preferredAccountId?: string
  ): ChatGptAccountCheckEntry {
    const candidates = workspaces.filter((workspace) => this.isParentWorkspaceCandidate(workspace));
    const preferred = preferredAccountId
      ? candidates.find((workspace) => workspace.accountId === preferredAccountId.trim())
      : undefined;
    if (preferred) return preferred;

    const current = candidates.find((workspace) => workspace.accountId === sessionAccountId);
    if (current) return current;
    if (candidates.length === 1) return candidates[0]!;
    if (candidates.length === 0) {
      throw new ServiceError(400, '当前 ChatGPT session 未发现可管理的 Team workspace，请确认录入的是母号 owner/admin session');
    }
    throw new ServiceError(409, '当前 ChatGPT session 可见多个 Team workspace，无法自动判断要录入的母号 Team');
  }

  private isParentWorkspaceCandidate(workspace: ChatGptAccountCheckEntry): boolean {
    if (workspace.canAccessWithSession === false) return false;
    if (workspace.structure !== 'workspace') return false;
    return workspace.role === 'account-owner' || workspace.role === 'account-admin';
  }

  private async resolveWebAccessTokenForWorkspace(
    session: ChatGptSessionInput,
    targetAccountId: string,
    proxy?: string
  ): Promise<string> {
    if (session.account.id === targetAccountId) return session.accessToken;
    if (!session.sessionToken) {
      throw new ServiceError(400, 'session JSON 缺少 sessionToken，无法切换到目标 Team workspace');
    }
    return this.fetchWorkspaceTokenFromSessionToken(session.sessionToken, targetAccountId, proxy);
  }

  private async fetchWorkspaceTokenFromSessionToken(
    sessionToken: string,
    targetAccountId: string,
    proxy?: string
  ): Promise<string> {
    try {
      return await fetchWorkspaceWebAccessTokenFromSessionToken(this.transport, sessionToken, targetAccountId, proxy);
    } catch (e) {
      if (e instanceof ChatGptWebSessionError) throw new ServiceError(e.status, e.message);
      throw e;
    }
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

  private async savePendingInviteCache(
    id: string,
    invites: PendingInvite[],
    options: { reconcileSeatSlots?: boolean } = {}
  ): Promise<Account> {
    const account = this.store.get(id);
    if (!account) throw new ServiceError(404, `母号不存在: ${id}`);
    const now = Date.now();
    const patch: Partial<Account> = {
      pendingInvitesCache: invites,
      pendingInvitesCachedAt: now,
      lastRefreshAt: now,
      lastError: undefined
    };
    if (options.reconcileSeatSlots !== false) {
      patch.seatSlots = this.reconcileSeatSlots(account, account.membersCache, invites);
    }
    const updated = await this.store.update(id, patch);
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

  async setMemberRole(
    id: string,
    userId: string,
    role: EditableMemberRole,
    confirmOwnerRisk = false
  ): Promise<AccountView> {
    const { api } = await this.clientFor(id);
    const members = await api.listMembers();
    const target = members.find((member) => member.userId === userId);
    if (!target) throw new ServiceError(404, `成员不存在: ${userId}`);
    if (target.role === role) {
      return this.viewFromAccount(await this.saveMemberCache(id, members));
    }

    const ownerTransition = target.role === 'account-owner' || role === 'account-owner';
    if (ownerTransition && !confirmOwnerRisk) {
      throw new ServiceError(409, MEMBER_OWNER_RISK_CONFIRM_MESSAGE);
    }

    try {
      await api.setMemberRole(userId, role);
    } catch (error) {
      if (error instanceof ChatGptApiError) {
        const status = error.status >= 400 && error.status < 500 ? error.status : 502;
        throw new ServiceError(status, readableChatGptApiError(error));
      }
      throw error;
    }
    return this.viewFromAccount(await this.refreshMemberCache(id, api));
  }

  async getCachedSettings(id: string): Promise<Record<string, unknown>> {
    const account = this.store.get(id);
    if (!account) throw new ServiceError(404, `母号不存在: ${id}`);
    return workspaceSettingsFromCache(account);
  }

  async refreshSettings(id: string): Promise<AccountView> {
    const { account, api } = await this.clientFor(id);
    const settings = await api.getSettings();
    const now = Date.now();
    let accountPatch: Partial<Account> = {};
    try {
      const check = await api.checkAccount();
      accountPatch = {
        planType: check.planType ?? account.planType,
        role: check.role ?? account.role,
        workspaceName: check.workspaceName ?? account.workspaceName,
        nextRenewalOn: check.nextRenewalOn ?? account.nextRenewalOn
      };
    } catch {
      accountPatch = {};
    }
    const patch: Partial<Account> = {
      ...workspaceSettingsPatchFromResponse(settings, now),
      ...accountPatch
    };
    const updated = await this.store.update(id, patch);
    if (!updated) throw new ServiceError(404, `母号不存在: ${id}`);
    return this.viewFromAccount(updated);
  }

  async getSettings(id: string): Promise<Record<string, unknown>> {
    const view = await this.refreshSettings(id);
    return workspaceSettingsFromCache(view);
  }

  async getCachedBillingSnapshot(id: string): Promise<AccountBillingSnapshot | null> {
    const account = this.store.get(id);
    if (!account) throw new ServiceError(404, `母号不存在: ${id}`);
    return this.requireBillingStore().get(id) ?? null;
  }

  async refreshBillingSnapshot(id: string): Promise<AccountBillingSnapshot> {
    const { account, api } = await this.clientFor(id);
    const raw = await api.getBillingSnapshotRaw();
    return this.requireBillingStore().save({
      accountId: account.id,
      workspaceAccountId: account.accountId,
      refreshedAt: Date.now(),
      raw
    });
  }

  private requireBillingStore(): AccountBillingStore {
    if (!this.billingStore) throw new ServiceError(500, 'AccountBillingStore 未初始化');
    return this.billingStore;
  }

  async setDefaultSeat(id: string, seat: SeatType): Promise<AccountView> {
    const { api } = await this.clientFor(id);
    const settings = await api.setDefaultSeat(seat);
    const now = Date.now();
    const updated = await this.store.update(id, workspaceSettingsPatchFromResponse(settings, now, { defaultSeat: seat }));
    if (!updated) throw new ServiceError(404, `母号不存在: ${id}`);
    return this.viewFromAccount(updated);
  }

  async setWorkspaceReferralsEnabled(id: string, enabled: boolean): Promise<AccountView> {
    const { api } = await this.clientFor(id);
    const settings = await api.setWorkspaceReferralsEnabled(enabled);
    const now = Date.now();
    const updated = await this.store.update(
      id,
      workspaceSettingsPatchFromResponse(settings, now, { workspaceReferralsEnabled: enabled })
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
      workspaceSettingsPatchFromResponse(settings, now, { personalAccessTokensEnabled: enabled })
    );
    if (!updated) throw new ServiceError(404, `母号不存在: ${id}`);
    return this.viewFromAccount(updated);
  }

  async setCodexDeviceCodeAuthEnabled(id: string, enabled: boolean): Promise<AccountView> {
    const { api } = await this.clientFor(id);
    const settings = await api.setCodexDeviceCodeAuthEnabled(enabled);
    const now = Date.now();
    const updated = await this.store.update(
      id,
      workspaceSettingsPatchFromResponse(settings, now, { codexDeviceCodeAuthEnabled: enabled })
    );
    if (!updated) throw new ServiceError(404, `母号不存在: ${id}`);
    return this.viewFromAccount(updated);
  }

  async setCodexRemoteControlEnabled(id: string, enabled: boolean): Promise<AccountView> {
    const { api } = await this.clientFor(id);
    const settings = await api.setCodexRemoteControlEnabled(enabled);
    const now = Date.now();
    const updated = await this.store.update(
      id,
      workspaceSettingsPatchFromResponse(settings, now, { codexRemoteControlEnabled: enabled })
    );
    if (!updated) throw new ServiceError(404, `母号不存在: ${id}`);
    return this.viewFromAccount(updated);
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
