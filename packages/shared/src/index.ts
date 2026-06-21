// team-manager 前后端共享类型。基于阶段一对 chatgpt.com/backend-api 的实测结构。

export { getChatGptSessionUserEmail, parseChatGptSessionInput } from './sessionInput.js';
export type { ChatGptSessionInput, ChatGptSessionParseResult } from './sessionInput.js';

/** 席位类型：default=ChatGPT 席位，usage_based=Codex 席位 */
export type SeatType = 'default' | 'usage_based';

/** 成员角色（backend-api account_user_role / users[].role） */
export type MemberRole = 'account-owner' | 'account-admin' | 'standard-user' | string;

/** 录入的母号（含凭证，仅存后端 data/，绝不下发前端明文） */
export interface Account {
  id: string;                 // team-manager 内部 id（uuid）
  label: string;              // 备注名
  accountId: string;          // workspace account_id（chatgpt-account-id 头）
  email: string;              // owner 邮箱
  accessToken: string;        // JWT，发请求用
  refreshToken?: string;      // 用于自动刷新
  fp?: AccountFingerprint;    // 每母号独立指纹
  proxy?: string;             // 每母号独立代理
  // 运行时状态（聚合 accounts/check）
  planType?: string;
  role?: MemberRole;
  workspaceName?: string;
  status?: 'active' | 'invalid' | 'unknown';
  membersCache?: Member[];    // 成员列表缓存，供前端先显示再后台刷新
  membersCachedAt?: number;
  defaultSeat?: SeatType;     // 新成员默认席位缓存
  defaultSeatCachedAt?: number;
  workspaceReferralsEnabled?: boolean; // 允许成员发送 Codex 邀请
  workspaceReferralsEnabledVisible?: boolean;
  workspaceReferralsEnabledCachedAt?: number;
  pendingInvitesCache?: PendingInvite[];
  pendingInvitesCachedAt?: number;
  lastRefreshAt?: number;
  lastError?: string;
}

export interface AccountFingerprint {
  deviceId?: string;          // oai-device-id
  sessionId?: string;         // oai-session-id
  userAgent?: string;
}

/** 下发前端的母号视图（脱敏，不含 token） */
export interface AccountView {
  id: string;
  label: string;
  accountId: string;
  email: string;
  planType?: string;
  role?: MemberRole;
  workspaceName?: string;
  status?: 'active' | 'invalid' | 'unknown';
  membersCache?: Member[];
  membersCachedAt?: number;
  defaultSeat?: SeatType;
  defaultSeatCachedAt?: number;
  workspaceReferralsEnabled?: boolean;
  workspaceReferralsEnabledVisible?: boolean;
  workspaceReferralsEnabledCachedAt?: number;
  pendingInvitesCache?: PendingInvite[];
  pendingInvitesCachedAt?: number;
  lastRefreshAt?: number;
  lastError?: string;
}

/** workspace 成员（GET /accounts/{id}/users → items[]） */
export interface Member {
  userId: string;             // users[].id
  email: string;
  name?: string;
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

/** 邀请录入 */
export interface InviteRequest {
  email: string;
  seat: SeatType;
  role?: MemberRole;          // 默认 standard-user
  confirmBillingRisk?: boolean;
}

export type SubaccountStatus =
  | 'empty'
  | 'session_ready'
  | 'codex_auth_pending'
  | 'codex_ready'
  | 'verification_required'
  | 'error';

/** 子号池记录（含敏感字段，仅后端 data/ 持久化） */
export interface Subaccount {
  id: string;                  // team-manager 内部 id（uuid）
  email: string;               // 只取 session.user.email 或注册得到的邮箱
  label: string;               // 默认同 email
  chatgptAccountId?: string;   // session.account.id
  webAccessToken?: string;     // 子号 ChatGPT Web accessToken
  codexCredentials?: SubaccountCodexCredential[];
  teamLinks?: SubaccountTeamLink[];
  status: SubaccountStatus;
  createdAt: number;
  updatedAt: number;
  lastError?: string;
}

/** 下发前端的子号视图（脱敏，不含 token） */
export interface SubaccountView {
  id: string;
  email: string;
  label: string;
  chatgptAccountId?: string;
  status: SubaccountStatus;
  hasWebSession: boolean;
  codexCredentials: SubaccountCodexCredentialView[];
  teamLinks: SubaccountTeamLink[];
  createdAt: number;
  updatedAt: number;
  lastError?: string;
}

export interface SubaccountTeamLink {
  accountId: string;             // team-manager 母号内部 id
  seat: SeatType;
  status: 'invited' | 'member' | 'removed' | 'unknown';
  updatedAt: number;
}

/** 子号在某个 ChatGPT workspace 下生成的 Codex 凭证，敏感字段仅后端持久化。 */
export interface SubaccountCodexCredential {
  credential: CodexCredentialJson;
  lastQuota?: CodexQuotaSnapshot;
  lastQuotaAt?: number;
  lastAuthAt?: number;
}

export interface SubaccountCodexCredentialView {
  accountId: string;
  hasCredential: boolean;
  planType?: string;
  lastQuota?: CodexQuotaSnapshot;
  lastQuotaAt?: number;
  lastAuthAt?: number;
}

/** CPA / Codex 兼容凭证 JSON，后端按需显式导出 */
export interface CodexCredentialJson {
  id_token: string;
  access_token: string;
  refresh_token: string;
  account_id: string;
  last_refresh: string;
  email: string;
  type: 'codex';
  expired: string;
  plan_type?: string;
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
  flaresolverr: boolean;
  gongxiMail: boolean;
  phoneOtp: boolean;
  phonePoolCount?: number;
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
