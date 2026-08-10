// team-manager 前后端共享类型。基于阶段一对 chatgpt.com/backend-api 的实测结构。

import type { ChatGptSessionInput } from './sessionInput.js';

export {
  billingCurrencyForCountry,
  CHECKOUT_COUNTRY_CODES,
  CHECKOUT_CURRENCIES
} from './checkoutOptions.js';

export {
  getChatGptSessionUserEmail,
  inspectChatGptSessionImportInput,
  parseChatGptSessionImportInput,
  parseChatGptSessionInput
} from './sessionInput.js';
export type {
  ChatGptSessionImportParseResult,
  ChatGptSessionInput,
  ChatGptSessionInputInspection,
  ChatGptSessionParseResult
} from './sessionInput.js';

/** 席位类型：default=ChatGPT 席位，usage_based=Codex 席位 */
export type SeatType = 'default' | 'usage_based';

export const ACCOUNT_OVERVIEW_DEFAULT_PAGE_SIZE = 60;
export const ACCOUNT_OVERVIEW_MAX_PAGE_SIZE = 100;

/** 母号本地额度窗口类型。 */
export type AccountLimitType = 'unknown' | 'weekly' | 'monthly';

/** Web 登录态各组成部分最近一次实测结果。 */
export type WebSessionCheckStatus = 'unknown' | 'valid' | 'invalid';

export interface SubaccountRateLimitResetCredits {
  credits: unknown[];
  availableCount: number;
  totalEarnedCount: number;
  cachedAt: number;
}

export const EDITABLE_MEMBER_ROLES = [
  'analytics-viewer',
  'standard-user',
  'account-admin',
  'account-owner'
] as const;

export type EditableMemberRole = (typeof EDITABLE_MEMBER_ROLES)[number];

export function isEditableMemberRole(value: unknown): value is EditableMemberRole {
  return typeof value === 'string' && (EDITABLE_MEMBER_ROLES as readonly string[]).includes(value);
}

/** 成员角色（backend-api account_user_role / users[].role） */
export type MemberRole = EditableMemberRole | string;

/** ChatGPT 移除成员响应中的席位替换/计费策略摘要。未知字段仍保存在 rawJson。 */
export interface MemberRemovalPolicyNotice {
  kind?: string;
  billedSeatDelta?: number;
  vacancyOrdinal?: number;
  freeVacancyThreshold?: number;
  expiresAt?: string;
  billingStartsAt?: string;
  replacementRequired?: boolean;
  rawJson: string;
}

/** 最近一次成功移除成员的上游结果，供后台判断临时计费风险。 */
export interface MemberRemovalRecord {
  userId: string;
  email?: string;
  seat?: SeatType;
  removedAt: number;
  upstreamSuccess?: boolean;
  billingNoticeJson?: string;
  policyNotice?: MemberRemovalPolicyNotice;
}

/** 录入的母号（含凭证，仅存后端 data/，绝不下发前端明文） */
export interface Account {
  id: string;                 // team-manager 内部 id（uuid）
  managedAccountEmail?: string; // GPT Account Manager 的规范化邮箱引用
  accountManagerHasPro5x?: boolean; // 最近一次明确同步确认的个人 Pro 5x 状态
  accountManagerPro5xCardLast4?: string; // 最近一次确认成功的 Pro 5x 支付卡尾号
  accountManagerSyncedAt?: number; // 最近一次明确同步 Account Manager 状态的时间
  remark?: string;            // 本地备注，不等同远端 Team 名称
  groupName?: string;         // 本地母号分组，缺省由后端归入默认分组
  limitType?: AccountLimitType; // 本地记录的额度窗口类型
  isBanned?: boolean;         // 人工封号标记；独立于远端账号状态
  accountId: string;          // workspace account_id（chatgpt-account-id 头）
  email: string;              // owner 邮箱
  accessToken: string;        // JWT，发请求用
  sessionToken?: string;      // ChatGPT session JSON 中的 sessionToken，用于按 workspace 换取 Web accessToken
  refreshToken?: string;      // 用于自动刷新
  fp?: AccountFingerprint;    // 每母号独立指纹
  proxy?: string;             // 每母号独立代理
  // 运行时状态（聚合 accounts/check）
  planType?: string;
  hasTeamSubscription?: boolean; // 当前 Workspace 是否存在有效的双席位 Team 订阅缓存
  role?: MemberRole;
  workspaceName?: string;
  nextRenewalOn?: string;     // 下次续费日期，yyyy-mm-dd
  status?: 'active' | 'invalid' | 'unknown';
  membersCache?: Member[];    // 成员列表缓存，供前端先显示再后台刷新
  membersCachedAt?: number;
  defaultSeat?: SeatType;     // 新成员默认席位缓存
  defaultSeatCachedAt?: number;
  workspaceReferralsEnabled?: boolean; // 允许成员发送 Codex 邀请
  workspaceReferralsEnabledVisible?: boolean;
  workspaceReferralsEnabledCachedAt?: number;
  autoAcceptRequests?: boolean; // 自动批准加入 Workspace 的请求
  autoAcceptRequestsCachedAt?: number;
  personalAccessTokensEnabled?: boolean; // 允许用户创建个人访问令牌
  personalAccessTokensCachedAt?: number;
  codexLocalAccessEnabled?: boolean; // 允许成员使用 Codex Local
  codexLocalAccessCachedAt?: number;
  codexDeviceCodeAuthEnabled?: boolean; // 为 Codex CLI 启用设备代码身份验证
  codexDeviceCodeAuthCachedAt?: number;
  codexRemoteControlEnabled?: boolean; // 允许成员远程发现并控制设备
  codexRemoteControlCachedAt?: number;
  automaticReloadEnabled?: boolean; // Credits 余额不足时自动补款
  automaticReloadCachedAt?: number;
  pendingInvitesCache?: PendingInvite[];
  pendingInvitesCachedAt?: number;
  lastMemberRemoval?: MemberRemovalRecord;
  seatSlots?: AccountSeatSlot[]; // 母号下的客户席位位置，本地运营主模型
  lastRefreshAt?: number;
  lastError?: string;
}

export interface AccountFingerprint {
  deviceId?: string;          // oai-device-id
  sessionId?: string;         // oai-session-id
  userAgent?: string;
}

/** 下发前端的母号视图。管理后台可信，允许编辑本地保存的 session JSON。 */
export interface AccountView {
  id: string;
  managedAccountEmail?: string;
  accountManagerHasPro5x?: boolean;
  accountManagerPro5xCardLast4?: string;
  accountManagerSyncedAt?: number;
  remark?: string;
  groupName: string;
  limitType: AccountLimitType;
  isBanned?: boolean;
  accountId: string;
  email: string;
  proxy?: string;
  session?: ChatGptSessionInput;
  planType?: string;
  role?: MemberRole;
  workspaceName?: string;
  nextRenewalOn?: string;
  status?: 'active' | 'invalid' | 'unknown';
  membersCache?: Member[];
  membersCachedAt?: number;
  defaultSeat?: SeatType;
  defaultSeatCachedAt?: number;
  workspaceReferralsEnabled?: boolean;
  workspaceReferralsEnabledVisible?: boolean;
  workspaceReferralsEnabledCachedAt?: number;
  autoAcceptRequests?: boolean;
  autoAcceptRequestsCachedAt?: number;
  personalAccessTokensEnabled?: boolean;
  personalAccessTokensCachedAt?: number;
  codexLocalAccessEnabled?: boolean;
  codexLocalAccessCachedAt?: number;
  codexDeviceCodeAuthEnabled?: boolean;
  codexDeviceCodeAuthCachedAt?: number;
  codexRemoteControlEnabled?: boolean;
  codexRemoteControlCachedAt?: number;
  automaticReloadEnabled?: boolean;
  automaticReloadCachedAt?: number;
  pendingInvitesCache?: PendingInvite[];
  pendingInvitesCachedAt?: number;
  lastMemberRemoval?: MemberRemovalRecord;
  seatSlots?: AccountSeatSlot[];
  lastRefreshAt?: number;
  lastError?: string;
  hasTeamSubscription: boolean;
  canManageWorkspace: boolean;
}

/** 母号列表摘要。只包含列表、筛选和操作入口需要的数据，不下发 Session 或详情缓存。 */
export interface AccountSummaryView {
  id: string;
  managedAccountEmail?: string;
  accountManagerHasPro5x?: boolean;
  accountManagerPro5xCardLast4?: string;
  accountManagerSyncedAt?: number;
  remark?: string;
  groupName: string;
  limitType: AccountLimitType;
  isBanned?: boolean;
  accountId: string;
  email: string;
  planType?: string;
  workspaceName?: string;
  nextRenewalOn?: string;
  status?: 'active' | 'invalid' | 'unknown';
  defaultSeat?: SeatType;
  lastRefreshAt?: number;
  lastError?: string;
  hasTeamSubscription: boolean;
  canManageWorkspace: boolean;
  memberAndInviteCount?: number;
  chatGptSeatUsageCount?: number;
  seatSlotCount: number;
  searchText: string;
}

/** 母号本地资料。敏感 Session 和代理只在打开编辑弹窗时按需读取。 */
export interface AccountLocalProfileView {
  id: string;
  remark?: string;
  groupName: string;
  limitType: AccountLimitType;
  isBanned?: boolean;
  nextRenewalOn?: string;
  proxy?: string;
  session?: ChatGptSessionInput;
}

/** 概览页构建席位位置需要的母号缓存，不包含 Session、代理和设置。 */
export type AccountOverviewView = Pick<
  AccountView,
  | 'id'
  | 'accountId'
  | 'email'
  | 'remark'
  | 'isBanned'
  | 'workspaceName'
  | 'nextRenewalOn'
  | 'hasTeamSubscription'
  | 'membersCache'
  | 'pendingInvitesCache'
  | 'seatSlots'
>;

export type SeatOverviewSource = 'seat-slot' | 'member' | 'invite' | 'placeholder';
export type SeatOverviewExpirySource = 'slot' | 'team-renewal';

export interface SeatOverviewFilterOptions {
  showOwners?: boolean;
  showCodexSeats?: boolean;
}

export interface AccountOverviewQuery extends SeatOverviewFilterOptions {
  page?: number;
  pageSize?: number;
}

export interface SeatOverviewItem {
  id: string;
  accountRecordId: string;
  workspaceAccountId: string;
  teamName: string;
  parentEmail: string;
  parentIsBanned?: boolean;
  source: SeatOverviewSource;
  status: AccountSeatSlotStatus;
  seat: SeatType;
  role?: MemberRole;
  email?: string;
  remark?: string;
  expiresOn?: string;
  expiresOnSource?: SeatOverviewExpirySource;
  price?: string;
  seatKey?: string;
}

export interface AccountOverviewPageView {
  items: SeatOverviewItem[];
  total: number;
  chatGptCount: number;
  codexCount: number;
  page: number;
  pageSize: number;
}

interface SeatOverviewRelation {
  id: string;
  email: string;
  role: MemberRole;
  seat: SeatType;
  status: AccountSeatSlotStatus;
  source: 'member' | 'invite';
}

const seatOverviewCollator = new Intl.Collator('zh-CN', {
  numeric: true,
  sensitivity: 'base'
});

export function buildSeatOverviewItems(accounts: readonly AccountOverviewView[]): SeatOverviewItem[] {
  return accounts.flatMap(buildAccountSeatOverviewItems).sort(compareSeatOverviewItems);
}

export function filterSeatOverviewItems<T extends SeatOverviewItem>(
  items: readonly T[],
  options: SeatOverviewFilterOptions = {}
): T[] {
  return items.filter((item) => {
    if (!options.showOwners && item.role === 'account-owner') return false;
    if (!options.showCodexSeats && item.seat === 'usage_based') return false;
    return true;
  });
}

function buildAccountSeatOverviewItems(account: AccountOverviewView): SeatOverviewItem[] {
  if (account.isBanned) return [];
  const relations = accountOverviewRelations(account);
  const relationByEmail = accountOverviewRelationMapByEmail(relations);
  const slottedEmails = new Set<string>();
  const items: SeatOverviewItem[] = [];

  for (const slot of account.seatSlots ?? []) {
    const normalizedEmail = normalizeOverviewEmail(slot.email);
    if (normalizedEmail) slottedEmails.add(normalizedEmail);
    const relation = normalizedEmail ? relationByEmail.get(normalizedEmail) : undefined;
    items.push({
      ...accountOverviewItemBase(account),
      id: `${account.id}:slot:${slot.seatKey}`,
      source: 'seat-slot',
      status: relation?.status ?? slot.status ?? (slot.email ? 'unknown' : 'empty'),
      seat: relation?.seat ?? slot.seat,
      role: relation?.role,
      email: slot.email,
      remark: slot.remark,
      expiresOn: slot.expiresOn,
      expiresOnSource: 'slot',
      price: slot.price,
      seatKey: slot.seatKey
    });
  }

  for (const relation of relations) {
    const normalizedEmail = normalizeOverviewEmail(relation.email);
    if (normalizedEmail && slottedEmails.has(normalizedEmail)) continue;
    if (normalizedEmail) slottedEmails.add(normalizedEmail);
    items.push({
      ...accountOverviewItemBase(account),
      id: `${account.id}:${relation.source}:${relation.id}`,
      source: relation.source,
      status: relation.status,
      seat: relation.seat,
      role: relation.role,
      email: relation.email,
      ...accountOverviewRenewalExpiry(account)
    });
  }

  if (account.hasTeamSubscription) {
    const chatGptPositionCount = items.filter((item) => item.seat === 'default').length;
    for (let index = chatGptPositionCount; index < MAX_CHATGPT_SEATS; index += 1) {
      items.push({
        ...accountOverviewItemBase(account),
        id: `${account.id}:empty:${index + 1}`,
        source: 'placeholder',
        status: 'empty',
        seat: 'default',
        ...accountOverviewRenewalExpiry(account)
      });
    }
  }

  return items;
}

function accountOverviewRelations(account: AccountOverviewView): SeatOverviewRelation[] {
  return [
    ...(account.membersCache ?? []).map((member): SeatOverviewRelation => ({
      id: member.userId,
      email: member.email,
      role: member.role,
      seat: member.seat,
      status: 'member',
      source: 'member'
    })),
    ...(account.pendingInvitesCache ?? []).map((invite): SeatOverviewRelation => ({
      id: invite.inviteId,
      email: invite.email,
      role: invite.role,
      seat: invite.seat,
      status: 'invited',
      source: 'invite'
    }))
  ];
}

function accountOverviewRelationMapByEmail(
  relations: readonly SeatOverviewRelation[]
): Map<string, SeatOverviewRelation> {
  const byEmail = new Map<string, SeatOverviewRelation>();
  for (const relation of relations) {
    const email = normalizeOverviewEmail(relation.email);
    if (email && !byEmail.has(email)) byEmail.set(email, relation);
  }
  return byEmail;
}

function accountOverviewItemBase(account: AccountOverviewView): Pick<
  SeatOverviewItem,
  'accountRecordId' | 'workspaceAccountId' | 'teamName' | 'parentEmail' | 'parentIsBanned'
> {
  const workspaceAccountId = typeof account.accountId === 'string' ? account.accountId : '';
  const parentEmail = typeof account.email === 'string' ? account.email : '';
  const teamName = account.workspaceName?.trim()
    || account.remark?.trim()
    || parentEmail
    || workspaceAccountId
    || '未命名 Team';
  return {
    accountRecordId: account.id,
    workspaceAccountId,
    teamName,
    parentEmail,
    parentIsBanned: account.isBanned === true
  };
}

function accountOverviewRenewalExpiry(
  account: AccountOverviewView
): Pick<SeatOverviewItem, 'expiresOn' | 'expiresOnSource'> {
  return account.nextRenewalOn
    ? { expiresOn: account.nextRenewalOn, expiresOnSource: 'team-renewal' }
    : {};
}

function compareSeatOverviewItems(a: SeatOverviewItem, b: SeatOverviewItem): number {
  return (
    Number(Boolean(a.parentIsBanned)) - Number(Boolean(b.parentIsBanned))
    || overviewDateRank(a.expiresOn) - overviewDateRank(b.expiresOn)
    || seatOverviewCollator.compare(a.teamName, b.teamName)
    || overviewSeatRank(a.seat) - overviewSeatRank(b.seat)
    || overviewSourceRank(a.source) - overviewSourceRank(b.source)
    || seatOverviewCollator.compare(a.email ?? '', b.email ?? '')
    || a.id.localeCompare(b.id)
  );
}

function overviewDateRank(value: string | undefined): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
}

function overviewSeatRank(seat: SeatType): number {
  return seat === 'default' ? 0 : 1;
}

function overviewSourceRank(source: SeatOverviewSource): number {
  if (source === 'seat-slot') return 0;
  if (source === 'member') return 1;
  if (source === 'invite') return 2;
  return 3;
}

function normalizeOverviewEmail(email: string | undefined): string {
  return email?.trim().toLowerCase() ?? '';
}

/** Team 升级订单的全局配置；母号可逐字段覆盖，空值表示继承全局。 */
export interface TeamOrderConfig {
  promoCode: string;
  country: string;
  currency: string;
}

export type TeamOrderConfigOverrides = Partial<TeamOrderConfig>;

export type TeamOrderMaintenanceStatus = 'active' | 'paused';

/** 独立于母号状态的订单维护池记录。 */
export interface TeamOrderMaintenance {
  accountId: string;
  status: TeamOrderMaintenanceStatus;
  overrides: TeamOrderConfigOverrides;
  nextRunAt: number;
  pauseReason?: string;
  lastSuccessAt?: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

export type TeamOrderStatus = 'queued' | 'running' | 'ready' | 'failed';
export type TeamOrderSource = 'scheduled' | 'manual' | 'manual_all';

/** 一次 TeamCode 订单维护任务及其最终支付链接。 */
export interface MaintainedTeamOrder {
  id: string;
  accountId: string;
  source: TeamOrderSource;
  status: TeamOrderStatus;
  scheduledFor: number;
  workspaceId: string;
  workspaceName: string;
  config: TeamOrderConfig;
  attemptCount: number;
  taskId?: string;
  payUrl?: string;
  stripeCreatedAt?: number;
  expiresAt?: number;
  retryAt?: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

/** 订单状态维护页面的一行，包含母号摘要、维护配置和最近订单。 */
export interface TeamOrderMaintenanceView {
  account: AccountSummaryView;
  maintenance: TeamOrderMaintenance;
  effectiveConfig: TeamOrderConfig;
  orders: MaintainedTeamOrder[];
}

export interface TeamOrderDashboardView {
  configured: boolean;
  globalConfig: TeamOrderConfig;
  items: TeamOrderMaintenanceView[];
}

export interface TeamOrderBatchResult {
  queued: number;
  skipped: number;
}

export function accountSummaryFromView(account: AccountView): AccountSummaryView {
  const members = account.membersCache;
  const invites = account.pendingInvitesCache;
  const hasRelationCache = Array.isArray(members) || Array.isArray(invites);
  const memberAndInviteCount = hasRelationCache
    ? (members?.length ?? 0) + (invites?.length ?? 0)
    : undefined;
  const chatGptSeatUsageCount = hasRelationCache
    ? (members?.filter((member) => member.seat === 'default').length ?? 0)
      + (invites?.filter((invite) => invite.seat === 'default').length ?? 0)
    : undefined;
  const searchText = [
    account.email,
    account.remark,
    account.groupName,
    account.workspaceName,
    account.accountId,
    account.nextRenewalOn,
    account.isBanned ? '封号 已封号' : undefined,
    ...(members ?? []).flatMap((member) => [member.email, member.remoteName, member.role]),
    ...(invites ?? []).flatMap((invite) => [invite.email, invite.role]),
    ...(account.seatSlots ?? []).flatMap((slot) => [
      slot.email,
      slot.remark,
      slot.expiresOn,
      slot.price,
      slot.seatKey
    ])
  ].filter((value): value is string => typeof value === 'string' && Boolean(value));

  return {
    id: account.id,
    managedAccountEmail: account.managedAccountEmail,
    accountManagerHasPro5x: account.accountManagerHasPro5x,
    accountManagerPro5xCardLast4: account.accountManagerPro5xCardLast4,
    accountManagerSyncedAt: account.accountManagerSyncedAt,
    remark: account.remark,
    groupName: account.groupName,
    limitType: account.limitType,
    isBanned: account.isBanned,
    accountId: account.accountId,
    email: account.email,
    planType: account.planType,
    workspaceName: account.workspaceName,
    nextRenewalOn: account.nextRenewalOn,
    status: account.status,
    defaultSeat: account.defaultSeat,
    lastRefreshAt: account.lastRefreshAt,
    lastError: account.lastError,
    hasTeamSubscription: account.hasTeamSubscription,
    canManageWorkspace: account.canManageWorkspace,
    memberAndInviteCount,
    chatGptSeatUsageCount,
    seatSlotCount: account.seatSlots?.length ?? 0,
    searchText: searchText.join('\n').toLowerCase()
  };
}

/** workspace 成员（GET /accounts/{id}/users → items[]） */
export interface Member {
  userId: string;             // users[].id
  email: string;
  remoteName?: string;        // ChatGPT 远端用户显示名，仅作辅助展示
  role: MemberRole;
  seat: SeatType;             // users[].seat_type
  status?: string;
}

/** 待处理邀请（GET /accounts/{id}/invites → items[]） */
export interface PendingInvite {
  inviteId: string;           // invites[].id
  email: string;              // invites[].email_address
  role: MemberRole;
  status: number;             // invites[].status
  seat: SeatType;             // invites[].seat_type
  createdTime: string;        // invites[].created_time
  isScimManaged: boolean;     // invites[].is_scim_managed
}

/** 客户席位的本地运营资料。 */
export interface AccountSeatSlotProfileInput {
  remark?: string;
  expiresOn?: string;
  expireRemove?: boolean;
  expireReminder?: boolean;
}

export type AccountSeatSlotStatus = 'empty' | 'invited' | 'member' | 'unknown';

export type SeatSlotSwapStatus = 'running' | 'succeeded' | 'failed';

export type SeatSlotSwapStepKey =
  | 'refreshing_parent'
  | 'confirming_current_email'
  | 'removing_current_member'
  | 'revoking_current_invite'
  | 'inviting_new_email'
  | 'saving_new_profile'
  | 'refreshing_final_state';

export interface SeatSlotSwapStep {
  key: SeatSlotSwapStepKey;
  label: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  message?: string;
  at?: number;
}

export interface SeatSlotSwapState {
  id: string;
  status: SeatSlotSwapStatus;
  fromEmail?: string;
  toEmail: string;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  error?: string;
  steps: SeatSlotSwapStep[];
}

/** 母号下一个售出的本地客户席位位置。邮箱只是当前位置的占用者。 */
export interface AccountSeatSlot {
  seatKey: string;
  email?: string;
  remark?: string;
  expiresOn: string;
  price?: string;
  seat: SeatType;
  status?: AccountSeatSlotStatus;
  currentUserId?: string;
  currentInviteId?: string;
  expireRemove: boolean;
  expireReminder: boolean;
  lastSwap?: SeatSlotSwapState;
  swapHistory?: SeatSlotSwapState[];
  updatedAt: number;
}

export interface PublicSeatSlotView {
  seatKey: string;
  email?: string;
  remark?: string;
  expiresOn: string;
  price?: string;
  seat: SeatType;
  status: AccountSeatSlotStatus;
  swap?: SeatSlotSwapState;
  swapHistory?: SeatSlotSwapState[];
}

export interface PublicSeatSwapRequest {
  email: string;
}

export interface AccountBillingSnapshot {
  accountId: string;
  workspaceAccountId: string;
  refreshedAt: number;
  raw: {
    invoices: unknown;
    upcomingInvoice: unknown;
    paymentMethods: unknown;
    billingInfo: unknown;
    seatTypeCounts: unknown;
  };
}

/** 邀请录入 */
export interface InviteRequest {
  email: string;
  seat: SeatType;
  role?: MemberRole;          // 默认 standard-user
  seatSlotProfile?: AccountSeatSlotProfileInput;
}

export interface NotificationSettings {
  advanceReminderDays: number;
  triggerTime: string;         // HH:mm，本地时区
  channels: NotificationChannels;
  lastRunDate?: string;
  lastRunAt?: number;
}

export interface RegistrationFormPreference {
  country: string;
  groupName: string;
}

export interface Pro5xFormPreference {
  usePromoCode: boolean;
  promoCode: string;
}

/** 跨浏览器保存的任务表单默认值；由 Team Manager 服务端持久化。 */
export interface TaskFormPreferences {
  parentRegistration: RegistrationFormPreference;
  subaccountRegistration: RegistrationFormPreference;
  pro5x: Pro5xFormPreference;
}

export const DEFAULT_TASK_FORM_PREFERENCES: TaskFormPreferences = {
  parentRegistration: { country: 'US', groupName: '默认分组' },
  subaccountRegistration: { country: 'US', groupName: '默认分组' },
  pro5x: { usePromoCode: true, promoCode: 'stb' }
};

export interface NotificationChannels {
  webhook: {
    enabled: boolean;
    url: string;
  };
  feishu: {
    enabled: boolean;
    webhookUrl: string;
  };
  telegram: {
    enabled: boolean;
    botToken: string;
    chatId: string;
  };
  wecom: {
    enabled: boolean;
    webhookUrl: string;
  };
}

export type NotificationChannelKey = keyof NotificationChannels;

export type SubaccountStatus =
  | 'empty'
  | 'session_ready'
  | 'codex_auth_pending'
  | 'pat_creating'
  | 'codex_ready'
  | 'verification_required'
  | 'account_locked'
  | 'error';

export type SubaccountRegistrationJobStatus =
  | 'queued'
  | 'running'
  | 'waiting_manual'
  | 'succeeded'
  | 'failed'
  | 'interrupted';

export type AccountManagerOperationStatus =
  | 'queued'
  | 'running'
  | 'waiting_for_otp'
  | 'waiting_manual'
  | 'succeeded'
  | 'failed'
  | 'interrupted';

export interface AccountManagerOperationView {
  id: string;
  accountId?: string;
  type: string;
  status: AccountManagerOperationStatus;
  phase: string;
  message?: string;
  email?: string;
  progress: number;
  control?: {
    id: string;
    type: 'retry_current_step' | 'rotate_proxy_sid';
    status: 'queued' | 'executing' | 'succeeded' | 'failed';
    requestedAt: number;
    updatedAt: number;
    requestedFromPhase?: string;
    completedAt?: number;
    error?: string;
  };
  requestSummary?: Record<string, unknown>;
  result?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export type AccountManagerProfileStatus = 'stopped' | 'queued' | 'running' | 'stopping' | 'failed';

export interface AccountManagerProfileView {
  accountId: string;
  status: AccountManagerProfileStatus;
  profileId?: string;
  error?: string;
  updatedAt: number;
}

export interface ResidentialProxyConfig {
  sid: string;
  country: string;
  asn: string | null;
  state: string | null;
  city: string | null;
}

export interface OpenCodexSpaceRequest {
  country: string;
  currency: string;
  credits: number;
  card: {
    number: string;
    expiryMonth: number;
    expiryYear: number;
    cvc: string;
  };
}

export interface OpenTeamSubscriptionRequest {
  workspaceId?: string;
  promoCode?: string;
  country: string;
  currency: string;
  autoPay?: boolean;
  card?: {
    number: string;
    expiryMonth: number;
    expiryYear: number;
    cvc: string;
  };
}

export interface OpenPro5xRequest {
  autoPay?: boolean;
  usePromoCode?: boolean;
  promoCode?: string;
  card: {
    number: string;
    expiryMonth: number;
    expiryYear: number;
    cvc: string;
  };
}

export interface AddPersonalPaymentMethodRequest {
  holderName: string;
  postalCode: string;
  card: OpenPro5xRequest['card'];
}

export interface PersonalPaymentMethodDefaults {
  holderName: string;
  postalCode: string;
  region: string;
}

export interface PersonalPaymentMethodView {
  id: string;
  type: string;
  brand?: string;
  last4: string;
  expMonth?: number;
  expYear?: number;
  isDefault: boolean;
}

export type PaymentAttemptOutcome =
  | 'pending'
  | 'waiting_manual'
  | 'succeeded'
  | 'failed'
  | 'interrupted';

export interface PaymentProxyObservation {
  sid?: string;
  ip?: string;
  country?: string;
  asn?: string | null;
  state?: string | null;
  city?: string | null;
  observedAt: number;
  observationError?: string;
}

export interface PaymentBillingObservation {
  email?: string;
  holderName: string;
  address: {
    line1: string;
    city?: string;
    state?: string;
    postalCode: string;
    phone?: string;
    country: string;
  };
  recordedAt: number;
}

export type Pro5xPaymentDecision =
  | 'succeeded'
  | 'payment_not_approved'
  | 'card_declined'
  | 'technical_failure'
  | 'interrupted'
  | 'waiting_manual'
  | 'pending';

export type Pro5xPaymentTransition =
  | 'payment_not_approved_to_succeeded'
  | 'payment_not_approved_to_payment_not_approved'
  | 'payment_not_approved_to_card_declined'
  | 'card_declined_to_succeeded'
  | 'card_declined_to_payment_not_approved'
  | 'card_declined_to_card_declined';

export interface Pro5xPaymentAttemptView {
  id: string;
  operationId: string;
  accountId: string;
  cardLast4: string;
  cardFingerprintSuffix: string;
  number: number;
  startedAt: number;
  completedAt?: number;
  outcome?: PaymentAttemptOutcome;
  decision: Pro5xPaymentDecision;
  proxyObservation?: PaymentProxyObservation;
  billingObservation?: PaymentBillingObservation;
  checkoutSessionId?: string;
  checkoutRecreated?: boolean;
  intervalFromPreviousMs?: number;
  amount?: number;
  currency?: string;
  errorCode?: string;
  errorMessage?: string;
  cardHardFailure: boolean;
}

export interface Pro5xPaymentStatisticsView {
  totalAttempts: number;
  decisionAttempts: number;
  uniqueOperations: number;
  succeeded: number;
  paymentNotApproved: number;
  cardDeclined: number;
  technicalFailures: number;
  interrupted: number;
  waitingManual: number;
  pending: number;
  transitions: Record<Pro5xPaymentTransition, number>;
  recentAttempts: Pro5xPaymentAttemptView[];
  updatedAt?: number;
}

export interface TeamUpgradeWorkspaceOption {
  id: string;
  name?: string;
  planType: string;
  isDeactivated: boolean;
}

export type ParentRegistrationStage =
  | 'registering'
  | 'waiting_manual'
  | 'registration_failed'
  | 'import_failed'
  | 'completed';

export interface ParentRegistrationTaskView {
  registration: AccountManagerOperationView;
  stage: ParentRegistrationStage;
  email?: string;
  parent?: AccountSummaryView;
  error?: string;
}

export interface ParentAccountManagerStatus {
  configured: boolean;
  reachable: boolean;
  managed: boolean;
  hasCodexSpace: boolean;
  hasTeamSubscription: boolean;
  hasPro5x?: boolean;
  accountEmail?: string;
  teamUpgradeWorkspaces?: TeamUpgradeWorkspaceOption[];
  codexOperation?: AccountManagerOperationView;
  teamOperation?: AccountManagerOperationView;
  pro5xOperation?: AccountManagerOperationView;
  enrollmentOperation?: AccountManagerOperationView;
  importedAccounts?: AccountSummaryView[];
  error?: string;
}

/** 子号关联的个人 GPT 账号在 GPT Account Manager 中的实时状态。 */
export interface SubaccountAccountManagerStatus {
  configured: boolean;
  reachable: boolean;
  managed: boolean;
  hasPro5x: boolean;
  accountEmail?: string;
  pro5xOperation?: AccountManagerOperationView;
  enrollmentOperation?: AccountManagerOperationView;
  error?: string;
}

/** ChatGPT 个人 Pro 订阅的续订状态；取消续订不等于退款或立即失去权益。 */
export interface Pro5xSubscriptionView {
  id: string;
  planType: string;
  activeStart?: string;
  activeUntil?: string;
  billingPeriod?: string;
  scheduledBillingPeriod?: string;
  willRenew: boolean;
  cancellationOutcome?: string;
  billingCurrency?: string;
  isDelinquent: boolean;
}

export interface Pro5xRenewalCancellationResult {
  idempotent: boolean;
  subscription: Pro5xSubscriptionView;
}

/** 自动注册后台任务。任务本身不包含密码、Cookie、验证码或 Token。 */
export interface SubaccountRegistrationJobView {
  id: string;
  status: SubaccountRegistrationJobStatus;
  phase: string;
  message: string;
  progress: number;
  email?: string;
  country?: string;
  groupName?: string;
  subaccountId?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  error?: string;
}

/** 子号池记录（含敏感字段，仅后端 data/ 持久化） */
export interface Subaccount {
  id: string;                  // team-manager 内部 id（uuid）
  email: string;               // 只取 session.user.email 或注册得到的邮箱
  remark?: string;             // 本地备注
  groupName?: string;          // 本地子号分组，缺省由后端归入默认分组
  isBanned?: boolean;          // 人工封号标记；独立于远端账号状态
  chatgptAccountId?: string;   // session.account.id
  webAccessToken?: string;     // 子号 ChatGPT Web accessToken
  sessionToken?: string;       // ChatGPT session JSON 中的 sessionToken，用于按 workspace 换取 Web accessToken
  webSessionCookies?: ChatGptWebSessionCookies; // 刷新 Web accessToken 所需的非浏览器会话 Cookie
  proxy?: string;              // 每子号独立代理
  managedAccountEmail?: string; // GPT Account Manager 的邮箱引用；未关联账号不设置
  chatgptUserId?: string;
  remoteUsername?: string;
  remoteDisplayName?: string;
  remotePictureUrl?: string;
  personalProfileCachedAt?: number;
  sessionTokenStatus?: WebSessionCheckStatus;
  sessionTokenCheckedAt?: number;
  webAccessTokenStatus?: WebSessionCheckStatus;
  webAccessTokenCheckedAt?: number;
  marketingPushEnabled?: boolean;
  marketingEmailEnabled?: boolean;
  marketingNotificationsCachedAt?: number;
  memoryEnabled?: boolean;
  memoryCachedAt?: number;
  rateLimitResetCredits?: SubaccountRateLimitResetCredits;
  accountManagerHasPro5x?: boolean;
  accountManagerPro5xCardLast4?: string;
  accountManagerSyncedAt?: number;
  pro5xSubscription?: Pro5xSubscriptionView;
  pro5xSubscriptionCheckedAt?: number;
  codexCredentials?: SubaccountCodexCredential[];
  teamLinks?: SubaccountTeamLink[];
  status: SubaccountStatus;
  createdAt: number;
  updatedAt: number;
  lastRefreshAt?: number;
  lastError?: string;
}

/** 仅后端持久化；不会通过 SubaccountView 下发到前端。 */
export interface ChatGptWebSessionCookies {
  oaiDid?: string;
  clientAuthInfo?: string;
  puid?: string;
  oaiIs?: string;
}

/** 下发前端的子号视图。管理后台可信，允许编辑本地保存的 Web session JSON。 */
export interface SubaccountView {
  id: string;
  email: string;
  remark?: string;
  groupName?: string;
  isBanned?: boolean;
  chatgptAccountId?: string;
  proxy?: string;
  managedAccountEmail?: string;
  chatgptUserId?: string;
  remoteUsername?: string;
  remoteDisplayName?: string;
  remotePictureUrl?: string;
  personalProfileCachedAt?: number;
  sessionTokenStatus?: WebSessionCheckStatus;
  sessionTokenCheckedAt?: number;
  webAccessTokenStatus?: WebSessionCheckStatus;
  webAccessTokenCheckedAt?: number;
  marketingPushEnabled?: boolean;
  marketingEmailEnabled?: boolean;
  marketingNotificationsCachedAt?: number;
  memoryEnabled?: boolean;
  memoryCachedAt?: number;
  rateLimitResetCredits?: SubaccountRateLimitResetCredits;
  accountManagerHasPro5x?: boolean;
  accountManagerPro5xCardLast4?: string;
  accountManagerSyncedAt?: number;
  pro5xSubscription?: Pro5xSubscriptionView;
  pro5xSubscriptionCheckedAt?: number;
  session?: ChatGptSessionInput;
  status: SubaccountStatus;
  hasWebSession: boolean;
  codexCredentials: SubaccountCodexCredentialView[];
  teamLinks: SubaccountTeamLink[];
  createdAt: number;
  updatedAt: number;
  lastRefreshAt?: number;
  lastError?: string;
}

/** 子号列表摘要。详情、凭证额度、Team 关联和 Session 均在选中记录后按需加载。 */
export interface SubaccountSummaryView {
  id: string;
  email: string;
  remark?: string;
  groupName?: string;
  isBanned?: boolean;
  managedAccountEmail?: string;
  accountManagerHasPro5x?: boolean;
  accountManagerPro5xCardLast4?: string;
  accountManagerSyncedAt?: number;
  pro5xSubscription?: Pro5xSubscriptionView;
  pro5xSubscriptionCheckedAt?: number;
  status: SubaccountStatus;
  hasWebSession: boolean;
  codexCredentialCount: number;
  teamLinkCount: number;
  createdAt: number;
  updatedAt: number;
  lastRefreshAt?: number;
  lastError?: string;
  searchText: string;
}

/** 子号本地资料。敏感 Session 和代理只在打开编辑弹窗时按需读取。 */
export interface SubaccountLocalProfileView {
  id: string;
  remark?: string;
  groupName?: string;
  isBanned?: boolean;
  proxy?: string;
  session?: ChatGptSessionInput;
}

export function subaccountSummaryFromView(subaccount: SubaccountView): SubaccountSummaryView {
  const searchText = [
    subaccount.email,
    subaccount.remark,
    subaccount.groupName,
    subaccount.chatgptAccountId,
    subaccount.remoteUsername,
    subaccount.remoteDisplayName,
    subaccount.managedAccountEmail,
    subaccount.status,
    subaccount.isBanned ? '封号 已封号' : undefined,
    ...subaccount.teamLinks.flatMap((link) => [
      link.workspaceId,
      link.workspaceName,
      link.planType,
      link.role
    ])
  ].filter((value): value is string => typeof value === 'string' && Boolean(value));

  return {
    id: subaccount.id,
    email: subaccount.email,
    remark: subaccount.remark,
    groupName: subaccount.groupName,
    isBanned: subaccount.isBanned,
    managedAccountEmail: subaccount.managedAccountEmail,
    accountManagerHasPro5x: subaccount.accountManagerHasPro5x,
    accountManagerPro5xCardLast4: subaccount.accountManagerPro5xCardLast4,
    accountManagerSyncedAt: subaccount.accountManagerSyncedAt,
    pro5xSubscription: subaccount.pro5xSubscription,
    pro5xSubscriptionCheckedAt: subaccount.pro5xSubscriptionCheckedAt,
    status: subaccount.status,
    hasWebSession: subaccount.hasWebSession,
    codexCredentialCount: subaccount.codexCredentials.length,
    teamLinkCount: subaccount.teamLinks.length,
    createdAt: subaccount.createdAt,
    updatedAt: subaccount.updatedAt,
    lastRefreshAt: subaccount.lastRefreshAt,
    lastError: subaccount.lastError,
    searchText: searchText.join('\n').toLowerCase()
  };
}

export interface SubaccountTeamLink {
  accountId: string;             // team-manager 母号内部 id；未录入母号的远端 workspace 使用 workspaceId 作为稳定占位
  workspaceId?: string;          // 远端 ChatGPT workspace account_id
  workspaceName?: string;        // accounts/check 返回的 workspace 名称
  planType?: string;             // accounts/check 返回的 plan_type，例如 team/business
  role?: MemberRole;             // 子号在该 workspace 的角色
  seat: SeatType;
  status: 'invited' | 'member' | 'removed' | 'unknown';
  updatedAt: number;
}

/** 子号在某个 ChatGPT workspace 下生成的 Codex 凭证，敏感字段仅后端持久化。 */
export interface SubaccountCodexCredential {
  accountId: string;             // credential.account_id，凭证绑定的 Team workspace
  fileName: string;              // data/subaccount-credentials/<subaccountId>/ 下的独立文件名
  groupName: string;             // CPA 号池分组名
  planType?: string;
  lastQuota?: CodexQuotaSnapshot;
  lastQuotaAt?: number;
  lastCreatedAt?: number;
}

export interface SubaccountCodexCredentialView {
  accountId: string;
  fileName: string;
  groupName: string;
  hasCredential: boolean;
  planType?: string;
  lastQuota?: CodexQuotaSnapshot;
  lastQuotaAt?: number;
  lastCreatedAt?: number;
}

interface CodexCredentialBase {
  access_token: string;
  account_id: string;
  last_refresh: string;
  email: string;
  type: 'codex';
  expired: string;
  plan_type?: string;
}

/** Codex OAuth authorization-code + PKCE 生成的 CPA/Codex 凭证。 */
export interface CodexOAuthCredentialJson extends CodexCredentialBase {
  id_token: string;
  refresh_token: string;
  auth_mode: 'chatgpt';
  credential_source: 'oauth';
}

/** ChatGPT workspace 个人访问令牌生成的 CPA/Codex 凭证。 */
export interface CodexPersonalAccessTokenCredentialJson extends CodexCredentialBase {
  personal_access_token: string;
  auth_mode: 'personalAccessToken';
  credential_source: 'personal_access_token';
  credential_id?: string;
  chatgpt_user_id?: string;
}

/** 后端按需显式导出的 Codex 凭证 JSON。 */
export type CodexCredentialJson =
  | CodexOAuthCredentialJson
  | CodexPersonalAccessTokenCredentialJson;

export interface CodexAuthStart {
  sessionId: string;
  authUrl: string;
  expiresAt: number;
  targetChatgptAccountId?: string;
}

export interface QuotaWindow {
  id: string;
  label: string;
  usedPercent: number | null;
  resetAt: string | null;
}

export interface CodexQuotaSnapshot {
  status: 'success' | 'unavailable' | 'error';
  planType: string | null;
  windows: QuotaWindow[];
  error: string | null;
}

export interface AccountManagerRuntimeStatus {
  configured: boolean;
  reachable: boolean;
  pro5xPromoCode?: string;
  error?: string;
}

export interface RrwebRecordingUploadView {
  uuid: string;
  uploadedAt: number;
  eventCount: number;
  uncompressedBytes: number;
  compressedBytes: number;
}

export interface SubaccountAuthLog {
  id: string;
  subaccountId?: string;
  phase: string;
  status: string;
  message: string;
  data?: Record<string, unknown>;
  createdAt: number;
}

/** 当前套餐包含的 ChatGPT 席位数量；超过后可能产生额外账单。 */
export const MAX_CHATGPT_SEATS = 2;

/** 统一 API 响应 */
export interface ApiResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}
