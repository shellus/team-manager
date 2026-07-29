import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  type Account,
  type AccountLimitType,
  type AccountSeatSlot,
  type AccountSeatSlotStatus,
  type Member,
  type MemberRemovalRecord,
  type SeatSlotSwapState,
  type SeatSlotSwapStep,
  type SeatSlotSwapStepKey
} from '@team-manager/shared';
import { ensurePrivateDirectory, ensurePrivateFile, writePrivateFile } from './privateDataFile.js';

type StoredAccount = Account & Record<string, unknown>;

const DEFAULT_ACCOUNT_GROUP = '默认分组';
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SEAT_KEY_PATTERN = /^[A-Za-z0-9]{16}$/;
const ACCOUNT_LIMIT_TYPES = new Set<AccountLimitType>(['unknown', 'weekly', 'monthly']);
const SEAT_SLOT_STATUSES = new Set<AccountSeatSlotStatus>(['empty', 'invited', 'member', 'unknown']);
const SWAP_STATUSES = new Set<SeatSlotSwapState['status']>(['running', 'succeeded', 'failed']);
const SWAP_STEP_KEYS = new Set<SeatSlotSwapStepKey>([
  'refreshing_parent',
  'confirming_current_email',
  'removing_current_member',
  'revoking_current_invite',
  'inviting_new_email',
  'saving_new_profile',
  'refreshing_final_state'
]);
const SWAP_STEP_STATUSES = new Set<SeatSlotSwapStep['status']>(['pending', 'running', 'done', 'failed', 'skipped']);

function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeLimitType(value: unknown): AccountLimitType {
  return typeof value === 'string' && ACCOUNT_LIMIT_TYPES.has(value as AccountLimitType)
    ? (value as AccountLimitType)
    : 'unknown';
}

function normalizeDateOnly(value: unknown): string | undefined {
  return typeof value === 'string' && DATE_ONLY_PATTERN.test(value.trim()) ? value.trim() : undefined;
}

function normalizeMembersCache(input: Account['membersCache']): Account['membersCache'] | undefined {
  if (!Array.isArray(input)) return undefined;

  const members: Member[] = [];
  for (const rawMember of input) {
    if (!rawMember || typeof rawMember !== 'object' || Array.isArray(rawMember)) continue;
    const member = rawMember as unknown as Record<string, unknown>;
    const userId = readTrimmedString(member.userId);
    const email = readTrimmedString(member.email);
    const role = readTrimmedString(member.role);
    const seat = readTrimmedString(member.seat);
    if (!userId || !email || !role || !seat) continue;

    const remoteName = readTrimmedString(member.remoteName);
    const status = readTrimmedString(member.status);
    members.push({
      userId,
      email,
      ...(remoteName ? { remoteName } : {}),
      role: role as Member['role'],
      seat: seat as Member['seat'],
      ...(status ? { status } : {})
    });
  }

  return members;
}

function normalizeSeatSlots(input: Account['seatSlots']): Account['seatSlots'] | undefined {
  if (!Array.isArray(input)) return undefined;

  const seen = new Set<string>();
  const slots: AccountSeatSlot[] = [];
  for (const rawSlot of input) {
    if (!rawSlot || typeof rawSlot !== 'object' || Array.isArray(rawSlot)) continue;
    const slot = rawSlot as unknown as Record<string, unknown>;
    const seatKey = readTrimmedString(slot.seatKey);
    if (!SEAT_KEY_PATTERN.test(seatKey) || seen.has(seatKey)) continue;
    const seat = slot.seat === 'usage_based' ? 'usage_based' : 'default';

    const expiresOn = normalizeDateOnly(slot.expiresOn);
    if (!expiresOn) continue;

    const email = normalizeEmail(slot.email);
    const remark = readTrimmedString(slot.remark);
    const price = readTrimmedString(slot.price);
    const statusValue = readTrimmedString(slot.status);
    const status = SEAT_SLOT_STATUSES.has(statusValue as AccountSeatSlotStatus)
      ? (statusValue as AccountSeatSlotStatus)
      : undefined;
    const currentUserId = readTrimmedString(slot.currentUserId);
    const currentInviteId = readTrimmedString(slot.currentInviteId);
    const updatedAt = typeof slot.updatedAt === 'number' && Number.isFinite(slot.updatedAt)
      ? slot.updatedAt
      : Date.now();
    const lastSwap = normalizeSeatSlotSwap(slot.lastSwap);
    const swapHistory = normalizeSeatSlotSwapHistory(slot.swapHistory, lastSwap);

    seen.add(seatKey);
    slots.push({
      seatKey,
      ...(email ? { email } : {}),
      ...(remark ? { remark } : {}),
      expiresOn,
      ...(price ? { price } : {}),
      seat,
      ...(status ? { status } : {}),
      ...(currentUserId ? { currentUserId } : {}),
      ...(currentInviteId ? { currentInviteId } : {}),
      expireRemove: typeof slot.expireRemove === 'boolean' ? slot.expireRemove : false,
      expireReminder: typeof slot.expireReminder === 'boolean' ? slot.expireReminder : true,
      ...(lastSwap ? { lastSwap } : {}),
      ...(swapHistory ? { swapHistory } : {}),
      updatedAt
    });
  }

  return slots.length ? slots : undefined;
}

function normalizeSeatSlotSwapHistory(input: unknown, lastSwap?: SeatSlotSwapState): SeatSlotSwapState[] | undefined {
  const history: SeatSlotSwapState[] = [];
  const seen = new Set<string>();
  if (Array.isArray(input)) {
    for (const item of input) {
      const swap = normalizeSeatSlotSwap(item);
      if (!swap || seen.has(swap.id)) continue;
      seen.add(swap.id);
      history.push(swap);
    }
  }

  if (lastSwap) {
    const existingIndex = history.findIndex((swap) => swap.id === lastSwap.id);
    if (existingIndex >= 0) {
      history[existingIndex] = lastSwap;
    } else {
      history.push(lastSwap);
    }
  }

  return history.length ? history : undefined;
}

function normalizeSeatSlotSwap(input: unknown): SeatSlotSwapState | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const raw = input as Record<string, unknown>;
  const id = readTrimmedString(raw.id);
  const status = readTrimmedString(raw.status);
  const toEmail = normalizeEmail(raw.toEmail);
  const startedAt = readNumber(raw.startedAt);
  const updatedAt = readNumber(raw.updatedAt);
  if (!id || !SWAP_STATUSES.has(status as SeatSlotSwapState['status']) || !toEmail || startedAt === undefined || updatedAt === undefined) {
    return undefined;
  }

  const fromEmail = normalizeEmail(raw.fromEmail);
  const completedAt = readNumber(raw.completedAt);
  const error = readTrimmedString(raw.error);
  const steps = Array.isArray(raw.steps) ? raw.steps.map(normalizeSeatSlotSwapStep).filter((step): step is SeatSlotSwapStep => Boolean(step)) : [];
  return {
    id,
    status: status as SeatSlotSwapState['status'],
    ...(fromEmail ? { fromEmail } : {}),
    toEmail,
    startedAt,
    updatedAt,
    ...(completedAt !== undefined ? { completedAt } : {}),
    ...(error ? { error } : {}),
    steps
  };
}

function normalizeSeatSlotSwapStep(input: unknown): SeatSlotSwapStep | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const raw = input as Record<string, unknown>;
  const key = readTrimmedString(raw.key);
  const status = readTrimmedString(raw.status);
  const label = readTrimmedString(raw.label);
  if (!SWAP_STEP_KEYS.has(key as SeatSlotSwapStepKey) || !SWAP_STEP_STATUSES.has(status as SeatSlotSwapStep['status']) || !label) {
    return undefined;
  }
  const message = readTrimmedString(raw.message);
  const at = readNumber(raw.at);
  return {
    key: key as SeatSlotSwapStepKey,
    label,
    status: status as SeatSlotSwapStep['status'],
    ...(message ? { message } : {}),
    ...(at !== undefined ? { at } : {})
  };
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeMemberRemovalRecord(input: Account['lastMemberRemoval']): MemberRemovalRecord | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const raw = input as unknown as Record<string, unknown>;
  const userId = readTrimmedString(raw.userId);
  const removedAt = readNumber(raw.removedAt);
  if (!userId || removedAt === undefined) return undefined;

  const email = normalizeEmail(raw.email);
  const seat = raw.seat === 'default' || raw.seat === 'usage_based' ? raw.seat : undefined;
  const billingNoticeJson = readTrimmedString(raw.billingNoticeJson);
  const rawPolicy = raw.policyNotice;
  let policyNotice: MemberRemovalRecord['policyNotice'];
  if (rawPolicy && typeof rawPolicy === 'object' && !Array.isArray(rawPolicy)) {
    const policy = rawPolicy as Record<string, unknown>;
    const rawJson = readTrimmedString(policy.rawJson);
    if (rawJson) {
      const kind = readTrimmedString(policy.kind);
      const expiresAt = readTrimmedString(policy.expiresAt);
      const billingStartsAt = readTrimmedString(policy.billingStartsAt);
      const billedSeatDelta = readNumber(policy.billedSeatDelta);
      const vacancyOrdinal = readNumber(policy.vacancyOrdinal);
      const freeVacancyThreshold = readNumber(policy.freeVacancyThreshold);
      policyNotice = {
        ...(kind ? { kind } : {}),
        ...(billedSeatDelta !== undefined ? { billedSeatDelta } : {}),
        ...(vacancyOrdinal !== undefined ? { vacancyOrdinal } : {}),
        ...(freeVacancyThreshold !== undefined ? { freeVacancyThreshold } : {}),
        ...(expiresAt ? { expiresAt } : {}),
        ...(billingStartsAt ? { billingStartsAt } : {}),
        ...(typeof policy.replacementRequired === 'boolean'
          ? { replacementRequired: policy.replacementRequired }
          : {}),
        rawJson
      };
    }
  }

  return {
    userId,
    ...(email ? { email } : {}),
    ...(seat ? { seat } : {}),
    removedAt,
    ...(typeof raw.upstreamSuccess === 'boolean' ? { upstreamSuccess: raw.upstreamSuccess } : {}),
    ...(billingNoticeJson ? { billingNoticeJson } : {}),
    ...(policyNotice ? { policyNotice } : {})
  };
}

function sanitizeAccount(input: StoredAccount): { account: Account; changed: boolean } {
  const email = readTrimmedString(input.email);
  const remark = readTrimmedString(input.remark);
  const membersCache = normalizeMembersCache(input.membersCache);
  const pendingInvitesCache = input.pendingInvitesCache;
  const lastMemberRemoval = normalizeMemberRemovalRecord(input.lastMemberRemoval);
  const seatSlots = normalizeSeatSlots(input.seatSlots);
  const normalized: Account = {
    id: input.id,
    ...(normalizeEmail(input.managedAccountEmail) ? { managedAccountEmail: normalizeEmail(input.managedAccountEmail) } : {}),
    ...(typeof input.accountManagerHasPro5x === 'boolean'
      ? { accountManagerHasPro5x: input.accountManagerHasPro5x }
      : {}),
    ...(/^\d{4}$/.test(readTrimmedString(input.accountManagerPro5xCardLast4))
      ? { accountManagerPro5xCardLast4: readTrimmedString(input.accountManagerPro5xCardLast4) }
      : {}),
    ...(typeof input.accountManagerSyncedAt === 'number'
      ? { accountManagerSyncedAt: input.accountManagerSyncedAt }
      : {}),
    ...(remark ? { remark } : {}),
    groupName: readTrimmedString(input.groupName) || DEFAULT_ACCOUNT_GROUP,
    limitType: normalizeLimitType(input.limitType),
    isBanned: input.isBanned === true,
    accountId: readTrimmedString(input.accountId),
    email,
    accessToken: readTrimmedString(input.accessToken),
    ...(readTrimmedString(input.sessionToken) ? { sessionToken: readTrimmedString(input.sessionToken) } : {}),
    ...(readTrimmedString(input.refreshToken) ? { refreshToken: readTrimmedString(input.refreshToken) } : {}),
    fp: input.fp,
    ...(readTrimmedString(input.proxy) ? { proxy: readTrimmedString(input.proxy) } : {}),
    ...(readTrimmedString(input.planType) ? { planType: readTrimmedString(input.planType) } : {}),
    ...(typeof input.hasTeamSubscription === 'boolean'
      ? { hasTeamSubscription: input.hasTeamSubscription }
      : {}),
    role: input.role,
    ...(readTrimmedString(input.workspaceName) ? { workspaceName: readTrimmedString(input.workspaceName) } : {}),
    ...(normalizeDateOnly(input.nextRenewalOn) ? { nextRenewalOn: normalizeDateOnly(input.nextRenewalOn) } : {}),
    status: input.status,
    membersCache,
    membersCachedAt: input.membersCachedAt,
    defaultSeat: input.defaultSeat,
    defaultSeatCachedAt: input.defaultSeatCachedAt,
    workspaceReferralsEnabled: input.workspaceReferralsEnabled,
    workspaceReferralsEnabledVisible: input.workspaceReferralsEnabledVisible,
    workspaceReferralsEnabledCachedAt: input.workspaceReferralsEnabledCachedAt,
    personalAccessTokensEnabled: input.personalAccessTokensEnabled,
    personalAccessTokensCachedAt: input.personalAccessTokensCachedAt,
    codexLocalAccessEnabled: input.codexLocalAccessEnabled,
    codexLocalAccessCachedAt: input.codexLocalAccessCachedAt,
    codexDeviceCodeAuthEnabled: input.codexDeviceCodeAuthEnabled,
    codexDeviceCodeAuthCachedAt: input.codexDeviceCodeAuthCachedAt,
    codexRemoteControlEnabled: input.codexRemoteControlEnabled,
    codexRemoteControlCachedAt: input.codexRemoteControlCachedAt,
    automaticReloadEnabled: input.automaticReloadEnabled,
    automaticReloadCachedAt: input.automaticReloadCachedAt,
    pendingInvitesCache,
    pendingInvitesCachedAt: input.pendingInvitesCachedAt,
    ...(lastMemberRemoval ? { lastMemberRemoval } : {}),
    seatSlots,
    lastRefreshAt: input.lastRefreshAt,
    ...(readTrimmedString(input.lastError) ? { lastError: readTrimmedString(input.lastError) } : {})
  };
  return { account: normalized, changed: JSON.stringify(normalized) !== JSON.stringify(input) };
}

/** 母号持久化：单个 JSON 文件 data/accounts.json，含凭证，仅后端读写。 */
export class AccountStore {
  private readonly file: string;
  private accounts = new Map<string, Account>();
  private loaded = false;

  constructor(private readonly dataDir: string) {
    this.file = join(dataDir, 'accounts.json');
  }

  async init(): Promise<void> {
    await ensurePrivateDirectory(this.dataDir);
    if (existsSync(this.file)) {
      await ensurePrivateFile(this.file);
      try {
        const raw = await readFile(this.file, 'utf8');
        const arr = JSON.parse(raw) as StoredAccount[];
        let changed = false;
        for (const a of arr) {
          if (a && typeof a.id === 'string') {
            const sanitized = sanitizeAccount(a);
            changed = changed || sanitized.changed;
            this.accounts.set(sanitized.account.id, sanitized.account);
          }
        }
        if (changed) await this.persist();
      } catch (e) {
        throw new Error(`读取 accounts.json 失败: ${(e as Error).message}`);
      }
    }
    this.loaded = true;
  }

  private ensureLoaded() {
    if (!this.loaded) throw new Error('AccountStore 未 init()');
  }

  list(): Account[] {
    this.ensureLoaded();
    return [...this.accounts.values()];
  }

  get(id: string): Account | undefined {
    this.ensureLoaded();
    return this.accounts.get(id);
  }

  getByWorkspaceAccountId(accountId: string): Account | undefined {
    this.ensureLoaded();
    const target = accountId.trim();
    return [...this.accounts.values()].find((account) => account.accountId === target);
  }

  getByManagedAccountEmail(email: string): Account | undefined {
    this.ensureLoaded();
    const target = normalizeEmail(email);
    return [...this.accounts.values()].find((account) => account.managedAccountEmail === target);
  }

  async add(input: Omit<Account, 'id'>): Promise<Account> {
    this.ensureLoaded();
    const { account } = sanitizeAccount({ ...input, id: randomUUID() });
    this.accounts.set(account.id, account);
    await this.persist();
    return account;
  }

  async update(id: string, patch: Partial<Account>): Promise<Account | undefined> {
    this.ensureLoaded();
    const existing = this.accounts.get(id);
    if (!existing) return undefined;
    const { account: merged } = sanitizeAccount({ ...existing, ...patch, id });
    this.accounts.set(id, merged);
    await this.persist();
    return merged;
  }

  async remove(id: string): Promise<boolean> {
    this.ensureLoaded();
    const ok = this.accounts.delete(id);
    if (ok) await this.persist();
    return ok;
  }

  private async persist(): Promise<void> {
    const arr = [...this.accounts.values()];
    await writePrivateFile(this.file, JSON.stringify(arr, null, 2));
  }
}
