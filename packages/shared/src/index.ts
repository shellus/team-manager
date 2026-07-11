// team-manager 前后端共享类型。基于阶段一对 chatgpt.com/backend-api 的实测结构。

import type { ChatGptSessionInput } from './sessionInput.js';

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

/** 母号本地额度窗口类型。 */
export type AccountLimitType = 'unknown' | 'weekly' | 'monthly';

export const EDITABLE_MEMBER_ROLES = [
  'analytics-viewer',
  'standard-user',
  'account-admin',
  'account-owner'
] as const;

export type EditableMemberRole = (typeof EDITABLE_MEMBER_ROLES)[number];

export const MEMBER_OWNER_RISK_CONFIRM_MESSAGE =
  '修改所有者角色可能导致母号失去 workspace 管理权限；ChatGPT 也可能因 workspace 创建时间限制拒绝操作。';

export function isEditableMemberRole(value: unknown): value is EditableMemberRole {
  return typeof value === 'string' && (EDITABLE_MEMBER_ROLES as readonly string[]).includes(value);
}

/** 成员角色（backend-api account_user_role / users[].role） */
export type MemberRole = EditableMemberRole | string;

/** 录入的母号（含凭证，仅存后端 data/，绝不下发前端明文） */
export interface Account {
  id: string;                 // team-manager 内部 id（uuid）
  remark?: string;            // 本地备注，不等同远端 Team 名称
  groupName?: string;         // 本地母号分组，缺省由后端归入默认分组
  limitType?: AccountLimitType; // 本地记录的额度窗口类型
  accountId: string;          // workspace account_id（chatgpt-account-id 头）
  email: string;              // owner 邮箱
  accessToken: string;        // JWT，发请求用
  sessionToken?: string;      // ChatGPT session JSON 中的 sessionToken，用于按 workspace 换取 Web accessToken
  refreshToken?: string;      // 用于自动刷新
  fp?: AccountFingerprint;    // 每母号独立指纹
  proxy?: string;             // 每母号独立代理
  // 运行时状态（聚合 accounts/check）
  planType?: string;
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
  personalAccessTokensEnabled?: boolean; // 允许用户创建个人访问令牌
  personalAccessTokensCachedAt?: number;
  codexLocalAccessEnabled?: boolean; // 允许成员使用 Codex Local
  codexLocalAccessCachedAt?: number;
  codexDeviceCodeAuthEnabled?: boolean; // 为 Codex CLI 启用设备代码身份验证
  codexDeviceCodeAuthCachedAt?: number;
  codexRemoteControlEnabled?: boolean; // 允许成员远程发现并控制设备
  codexRemoteControlCachedAt?: number;
  pendingInvitesCache?: PendingInvite[];
  pendingInvitesCachedAt?: number;
  memberProfiles?: Record<string, AccountMemberProfile>; // 母号下的邮箱维度本地资料，key 为小写邮箱
  seatSlots?: AccountSeatSlot[]; // 母号下的固定 ChatGPT 席位位置，本地运营主模型
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
  remark?: string;
  groupName: string;
  limitType: AccountLimitType;
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
  personalAccessTokensEnabled?: boolean;
  personalAccessTokensCachedAt?: number;
  codexLocalAccessEnabled?: boolean;
  codexLocalAccessCachedAt?: number;
  codexDeviceCodeAuthEnabled?: boolean;
  codexDeviceCodeAuthCachedAt?: number;
  codexRemoteControlEnabled?: boolean;
  codexRemoteControlCachedAt?: number;
  pendingInvitesCache?: PendingInvite[];
  pendingInvitesCachedAt?: number;
  memberProfiles?: Record<string, AccountMemberProfile>;
  seatSlots?: AccountSeatSlot[];
  lastRefreshAt?: number;
  lastError?: string;
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

/** 母号下某个成员/邀请邮箱的本地资料，跟随邮箱从 pending invite 过渡到 member。 */
export interface AccountMemberProfile {
  email: string;
  remark?: string;
  expiresOn: string;           // yyyy-mm-dd
  expireRemove: boolean;
  expireReminder: boolean;
  updatedAt: number;
}

export interface AccountMemberProfileInput {
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

/** 母号下一个售出的 ChatGPT 固定席位位置。邮箱只是当前位置的占用者。 */
export interface AccountSeatSlot {
  seatKey: string;
  email?: string;
  remark?: string;
  expiresOn: string;
  price?: string;
  seat: 'default';
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
  confirmBillingRisk?: boolean;
  memberProfile?: AccountMemberProfileInput;
}

export interface NotificationSettings {
  advanceReminderDays: number;
  triggerTime: string;         // HH:mm，本地时区
  channels: NotificationChannels;
  lastRunDate?: string;
  lastRunAt?: number;
}

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
  | 'codex_ready'
  | 'verification_required'
  | 'account_locked'
  | 'error';

/** 子号池记录（含敏感字段，仅后端 data/ 持久化） */
export interface Subaccount {
  id: string;                  // team-manager 内部 id（uuid）
  email: string;               // 只取 session.user.email 或注册得到的邮箱
  remark?: string;             // 本地备注
  chatgptAccountId?: string;   // session.account.id
  webAccessToken?: string;     // 子号 ChatGPT Web accessToken
  sessionToken?: string;       // ChatGPT session JSON 中的 sessionToken，用于按 workspace 换取 Web accessToken
  proxy?: string;              // 每子号独立代理
  registrationPassword?: string; // 自动注册生成的 OpenAI 密码，仅后端持久化，不下发前端
  registeredAt?: number;
  registrationSource?: string;
  codexCredentials?: SubaccountCodexCredential[];
  teamLinks?: SubaccountTeamLink[];
  status: SubaccountStatus;
  createdAt: number;
  updatedAt: number;
  lastError?: string;
}

/** 下发前端的子号视图。管理后台可信，允许编辑本地保存的 Web session JSON。 */
export interface SubaccountView {
  id: string;
  email: string;
  remark?: string;
  chatgptAccountId?: string;
  proxy?: string;
  session?: ChatGptSessionInput;
  status: SubaccountStatus;
  hasWebSession: boolean;
  codexCredentials: SubaccountCodexCredentialView[];
  teamLinks: SubaccountTeamLink[];
  createdAt: number;
  updatedAt: number;
  lastError?: string;
}

export interface SubaccountTeamLink {
  accountId: string;             // team-manager 母号内部 id；未录入母号的远端 workspace 使用 workspaceId 作为稳定占位
  workspaceId?: string;          // 远端 ChatGPT workspace account_id
  workspaceName?: string;        // accounts/check 返回的 workspace 名称
  planType?: string;             // accounts/check 返回的 plan_type，例如 team/k12
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
  lastAuthAt?: number;
}

export interface SubaccountCodexCredentialView {
  accountId: string;
  fileName: string;
  groupName: string;
  hasCredential: boolean;
  planType?: string;
  lastQuota?: CodexQuotaSnapshot;
  lastQuotaAt?: number;
  lastAuthAt?: number;
}

/** CPA / Codex 兼容凭证 JSON，后端按需显式导出 */
export interface CodexCredentialJson {
  id_token?: string;
  access_token: string;
  refresh_token?: string;
  account_id: string;
  last_refresh: string;
  email: string;
  type: 'codex';
  expired: string;
  plan_type?: string;
  auth_mode?: 'chatgpt' | 'personalAccessToken';
  credential_source?: 'oauth' | 'personal_access_token';
  personal_access_token?: string;
  credential_id?: string;
  chatgpt_user_id?: string;
  issued_account_id?: string;
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

export interface CodexAuthRuntimeStatus {
  workerConfigured: boolean;
  workerReachable: boolean;
  codexAutoAuth: boolean;
  subaccountRegistration: boolean;
  flaresolverr: boolean;
  gongxiMail: boolean;
  phoneOtp: boolean;
  phonePoolCount?: number;
  phonePoolExhaustedCount?: number;
  error?: string;
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

export const BILLING_RISK_CONFIRM_MESSAGE =
  '此操作将会导致超出已有席位数量，可能导致额外的账单，确认吗？（您可以先将现有成员转为Codex席位后安全进行）';

/** 统一 API 响应 */
export interface ApiResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}
