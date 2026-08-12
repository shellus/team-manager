import { randomUUID } from 'node:crypto';
import type { EditableMemberRole, Member, PendingInvite, SeatType, MemberRole } from '@team-manager/shared';
import { fetchWithRawTrace, type Transport } from './transport.js';

interface AccountFingerprint { deviceId?: string; sessionId?: string; userAgent?: string }
interface BillingRaw extends Record<string, unknown> { invoices: unknown; upcomingInvoice: unknown; paymentMethods: unknown; billingInfo: unknown; seatTypeCounts: unknown }

const OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const OAUTH_CLIENT_ID = 'app_2SKx67EdpoN0G6j64rFvigXD';
const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const REFRESH_SKEW_SECONDS = 24 * 60 * 60;

export interface RefreshResult {
  accessToken: string;
  refreshToken?: string;
}

export interface ChatGptAccountContext {
  accountId: string;
  accessToken: string;
  fp?: AccountFingerprint;
  proxy?: string;
  refreshWebAccessToken?: () => Promise<string>;
}

export interface ChatGptAccountCheckEntry {
  accountId: string;
  role?: MemberRole;
  workspaceName?: string;
  nextRenewalOn?: string;
  planType?: string;
  structure?: string;
  canAccessWithSession?: boolean;
}

export interface CodexPersonalAccessTokenResponse {
  credential_id?: string;
  created_at?: number;
  owner_user_id?: string;
  creator_user_email?: string;
  name?: string;
  workspace_id?: string;
  scopes?: string[];
  expires_at?: number;
  revoked?: boolean;
  expired?: boolean;
  access_token?: string;
}

export interface ChatGptMeResponse extends Record<string, unknown> {
  id?: string;
  email?: string;
  name?: string;
  picture?: string;
}

export interface ChatGptPersonalProfileResponse extends Record<string, unknown> {
  user_id?: string;
  username?: string;
  display_name?: string;
  profile_picture_url?: string;
}

export interface ChatGptNotificationSettingsResponse extends Record<string, unknown> {
  settings?: Array<{
    category?: string;
    options?: Array<{ channel?: string; enabled?: boolean }>;
  }>;
}

export interface ChatGptRateLimitResetCreditsResponse extends Record<string, unknown> {
  credits?: unknown[];
  available_count?: number;
  total_earned_count?: number;
}

export interface AutomaticReloadSettingsResponse extends Record<string, unknown> {
  is_enabled?: boolean;
  recharge_threshold?: string | null;
  recharge_target?: string | null;
  recharge_monthly_limit?: string | null;
  recharge_monthly_remaining?: string | null;
  immediate_top_up_status?: string | null;
  immediate_top_up_message?: string | null;
}

export interface ChatGptPersonalSubscriptionResponse extends Record<string, unknown> {
  id?: string;
  plan_type?: string;
  active_start?: string;
  active_until?: string;
  billing_period?: string;
  scheduled_billing_period?: string;
  will_renew?: boolean;
  cancellation_outcome?: string;
  billing_currency?: string;
  is_delinquent?: boolean;
}

/**
 * ChatGPT 网页 backend-api 薄封装。
 * 阶段一实测：所有请求必须带 Authorization: Bearer；workspace 操作还需 chatgpt-account-id。
 * 请求通过 Transport 发出，部署默认由 curl_cffi sidecar 处理 Cloudflare/TLS 指纹。
 */
export class ChatGptApi {
  constructor(
    private readonly account: ChatGptAccountContext,
    private readonly transport: Transport
  ) {}

  private headers(targetPath: string, extra: Record<string, string> = {}): Record<string, string> {
    const fp = this.account.fp ?? {};
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.account.accessToken}`,
      'chatgpt-account-id': this.account.accountId,
      'oai-device-id': fp.deviceId ?? randomUUID(),
      'oai-session-id': fp.sessionId ?? randomUUID(),
      'x-openai-target-path': targetPath,
      'x-openai-target-route': targetPath,
      ...extra
    };
    return headers;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res = await this.fetchOnce(method, path, body);
    if (this.canRefreshAfterAuthFailure(res)) {
      const refreshed = await this.account.refreshWebAccessToken?.();
      if (refreshed) {
        this.account.accessToken = refreshed;
        res = await this.fetchOnce(method, path, body);
      }
    }
    if (res.status < 200 || res.status >= 300) {
      throw new ChatGptApiError(res.status, res.body, `${method} ${path}`);
    }
    return (res.body ? JSON.parse(res.body) : {}) as T;
  }

  private async fetchOnce(method: string, path: string, body?: unknown) {
    const extra: Record<string, string> = {};
    let payload: string | undefined;
    if (body !== undefined) {
      extra['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    return this.transport.fetch({
      method,
      path,
      headers: this.headers(path, extra),
      body: payload,
      proxy: this.account.proxy?.trim() || undefined
    });
  }

  private canRefreshAfterAuthFailure(res: { status: number; body: string }): boolean {
    if (!this.account.refreshWebAccessToken || res.status !== 401) return false;
    return isTokenInvalidatedResponse(res.body);
  }

  /** 当前 ChatGPT session 可见的账号 / workspace 列表。 */
  async checkAccountsRaw(): Promise<Record<string, unknown>> {
    const path = '/backend-api/accounts/check/v4-2023-04-27?timezone_offset_min=-480';
    return this.request<Record<string, unknown>>('GET', path);
  }

  /** 当前 ChatGPT session 可见的账号 / workspace 列表。 */
  async checkAccounts(): Promise<ChatGptAccountCheckEntry[]> {
    return parseChatGptAccountCheckEntries(await this.checkAccountsRaw());
  }

  async getMe(): Promise<ChatGptMeResponse> {
    return this.request<ChatGptMeResponse>('GET', '/backend-api/me');
  }

  async getPersonalProfile(userId: string): Promise<ChatGptPersonalProfileResponse> {
    return this.request<ChatGptPersonalProfileResponse>(
      'GET',
      `/backend-api/calpico/chatgpt/profile/${encodeURIComponent(userId)}`
    );
  }

  async setPersonalUsername(userId: string, username: string): Promise<ChatGptPersonalProfileResponse> {
    return this.request<ChatGptPersonalProfileResponse>(
      'POST',
      `/backend-api/calpico/chatgpt/profile/${encodeURIComponent(userId)}/username`,
      { username }
    );
  }

  async setPersonalDisplayName(userId: string, displayName: string): Promise<ChatGptPersonalProfileResponse> {
    return this.request<ChatGptPersonalProfileResponse>(
      'POST',
      `/backend-api/calpico/chatgpt/profile/${encodeURIComponent(userId)}`,
      { display_name: displayName }
    );
  }

  async getNotificationSettings(): Promise<ChatGptNotificationSettingsResponse> {
    return this.request<ChatGptNotificationSettingsResponse>('GET', '/backend-api/notifications/settings');
  }

  async setMarketingNotifications(input: {
    push?: boolean;
    email?: boolean;
  }): Promise<ChatGptNotificationSettingsResponse> {
    return this.request<ChatGptNotificationSettingsResponse>('PATCH', '/backend-api/notifications/settings', {
      updates: { marketing: input }
    });
  }

  async setMemoryEnabled(enabled: boolean): Promise<Record<string, unknown>> {
    return this.request(
      'PATCH',
      `/backend-api/settings/account_user_setting?feature=m3m&value=${enabled ? 'true' : 'false'}`,
      {}
    );
  }

  async getRateLimitResetCredits(): Promise<ChatGptRateLimitResetCreditsResponse> {
    return this.request<ChatGptRateLimitResetCreditsResponse>('GET', '/backend-api/wham/rate-limit-reset-credits');
  }

  /** 当前执行账号从 accounts/check 观察到的 Workspace 状态。 */
  async checkAccount(): Promise<{ planType?: string; role?: MemberRole; workspaceName?: string; nextRenewalOn?: string }> {
    const entry = (await this.checkAccounts()).find((item) => item.accountId === this.account.accountId);
    if (!entry) return {};
    return {
      planType: entry.planType,
      role: entry.role,
      workspaceName: entry.workspaceName,
      nextRenewalOn: entry.nextRenewalOn
    };
  }

  async getPersonalSubscription(): Promise<ChatGptPersonalSubscriptionResponse> {
    return this.request<ChatGptPersonalSubscriptionResponse>(
      'GET',
      `/backend-api/subscriptions?account_id=${encodeURIComponent(this.account.accountId)}`
    );
  }

  async cancelPersonalSubscriptionRenewal(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('POST', '/backend-api/subscriptions/cancel', {
      account_id: this.account.accountId
    });
  }

  /** 列成员（分页 ≤25，自动翻页聚合） */
  async listMembers(): Promise<Member[]> {
    const all: Member[] = [];
    const pageSize = 25;
    for (let offset = 0; offset < 1000; offset += pageSize) {
      const path = `/backend-api/accounts/${this.account.accountId}/users?offset=${offset}&limit=${pageSize}`;
      const data = await this.request<{ items?: RawMember[] }>('GET', path);
      const items = data.items ?? [];
      for (const u of items) {
        all.push({
          userId: u.id,
          email: u.email,
          remoteName: u.name,
          role: u.role,
          seat: (u.seat_type as SeatType) ?? 'default',
          status: u.status
        });
      }
      if (items.length < pageSize) break;
    }
    return all;
  }
  /** 邀请新成员 */
  async invite(email: string, seat: SeatType, role: MemberRole = 'standard-user'): Promise<unknown> {
    const path = `/backend-api/accounts/${this.account.accountId}/invites`;
    return this.request('POST', path, {
      email_addresses: [email],
      role,
      seat_type: seat,
      resend_emails: true
    });
  }

  /** 当前登录用户向目标 workspace 发起自助加入请求。 */
  async requestWorkspaceInvite(workspaceId: string): Promise<unknown> {
    const target = workspaceId.trim();
    if (!target) throw new Error('缺少 workspace ID');
    const path = `/backend-api/accounts/${target}/invites/request`;
    return this.request('POST', path, {});
  }

  /** 列待处理邀请（分页 ≤25，自动翻页聚合） */
  async listPendingInvites(): Promise<PendingInvite[]> {
    const all: PendingInvite[] = [];
    const pageSize = 25;
    for (let offset = 0; offset < 1000; offset += pageSize) {
      const path = `/backend-api/accounts/${this.account.accountId}/invites?offset=${offset}&limit=${pageSize}&query=`;
      const data = await this.request<{ items?: RawPendingInvite[] }>('GET', path);
      const items = data.items ?? [];
      for (const invite of items) {
        all.push({
          inviteId: invite.id,
          email: invite.email_address,
          role: invite.role,
          status: invite.status,
          seat: invite.seat_type as SeatType,
          createdTime: invite.created_time,
          isScimManaged: invite.is_scim_managed
        });
      }
      if (items.length < pageSize) break;
    }
    return all;
  }

  /** 只读取待处理邀请数量，避免为了显示数量拉完整列表。 */
  async countPendingInvites(): Promise<number> {
    const path = `/backend-api/accounts/${this.account.accountId}/invites?offset=0&limit=1&query=`;
    const data = await this.request<{ items?: RawPendingInvite[]; total?: number }>('GET', path);
    return typeof data.total === 'number' ? data.total : data.items?.length ?? 0;
  }

  /** 撤销待处理邀请 */
  async revokePendingInvite(email: string): Promise<unknown> {
    const path = `/backend-api/accounts/${this.account.accountId}/invites`;
    return this.request('DELETE', path, { email_address: email });
  }

  /** 移除成员 */
  async removeMember(userId: string): Promise<ChatGptMemberRemovalResponse> {
    const path = `/backend-api/accounts/${this.account.accountId}/users/${userId}`;
    return this.request<ChatGptMemberRemovalResponse>('DELETE', path);
  }

  /** 修改成员席位类型（字段为 seat_type：default=ChatGPT，usage_based=Codex）。 */
  async setMemberSeat(userId: string, seat: SeatType): Promise<unknown> {
    const path = `/backend-api/accounts/${this.account.accountId}/users/${userId}`;
    return this.request('PATCH', path, { seat_type: seat });
  }

  /** 修改 workspace 成员角色。 */
  async setMemberRole(userId: string, role: EditableMemberRole): Promise<unknown> {
    const path = `/backend-api/accounts/${this.account.accountId}/users/${userId}`;
    return this.request('PATCH', path, { role });
  }

  /** 读 workspace 设置（含 default_seat_type、workspace_referrals_enabled、permissions） */
  async getSettings(): Promise<Record<string, unknown>> {
    const path = `/backend-api/accounts/${this.account.accountId}/settings`;
    return this.request('GET', path);
  }

  /** 改新成员默认席位类型 */
  async setDefaultSeat(seat: SeatType): Promise<Record<string, unknown>> {
    const path = `/backend-api/accounts/${this.account.accountId}/settings/default_seat_type`;
    return this.request('POST', path, { value: seat });
  }

  /** 改“允许成员发送 Codex 邀请”开关 */
  async setWorkspaceReferralsEnabled(enabled: boolean): Promise<Record<string, unknown>> {
    const path = `/backend-api/accounts/${this.account.accountId}/settings/workspace_referrals_enabled`;
    return this.request('POST', path, { value: enabled });
  }

  async setAutoAcceptRequests(enabled: boolean): Promise<Record<string, unknown>> {
    const path = `/backend-api/accounts/${this.account.accountId}/settings/auto_accept_requests`;
    return this.request('POST', path, { value: enabled });
  }

  async getBillingSnapshotRaw(): Promise<BillingRaw> {
    const workspaceAccountId = encodeURIComponent(this.account.accountId);
    const invoices = await this.request<unknown>('GET', `/backend-api/invoices?limit=10&account_id=${workspaceAccountId}`);
    const upcomingInvoice = await this.getUpcomingInvoiceOrNull(workspaceAccountId);
    const paymentMethods = await this.request<unknown>(
      'GET',
      `/backend-api/payments/payment_methods?account_id=${workspaceAccountId}`
    );
    const billingInfo = await this.request<unknown>(
      'GET',
      `/backend-api/payments/billing_info?account_id=${workspaceAccountId}`
    );
    const seatTypeCounts = await this.request<unknown>(
      'GET',
      `/backend-api/accounts/${this.account.accountId}/users/seat_type_counts`
    );
    return { invoices, upcomingInvoice, paymentMethods, billingInfo, seatTypeCounts };
  }

  async hasTeamSubscription(): Promise<boolean> {
    const workspaceAccountId = encodeURIComponent(this.account.accountId);
    const upcoming = await this.getUpcomingInvoiceOrNull(workspaceAccountId);
    const source = upcoming && typeof upcoming === 'object' ? upcoming as Record<string, unknown> : {};
    const text = JSON.stringify(source).toLowerCase();
    return text.includes('team') || text.includes('business');
  }

  async getAutomaticReloadSettings(): Promise<AutomaticReloadSettingsResponse> {
    return this.request('GET', '/backend-api/subscriptions/auto_top_up/settings');
  }

  async setAutomaticReloadEnabled(enabled: boolean): Promise<AutomaticReloadSettingsResponse> {
    return this.request('POST', `/backend-api/subscriptions/auto_top_up/${enabled ? 'enable' : 'disable'}`);
  }

  private async getUpcomingInvoiceOrNull(workspaceAccountId: string): Promise<unknown> {
    try {
      return await this.request<unknown>(
        'GET',
        `/backend-api/invoices/upcoming?account_id=${workspaceAccountId}`
      );
    } catch (error) {
      if (isMissingUpcomingInvoice(error)) return null;
      throw error;
    }
  }

  /** 改“允许用户创建个人访问令牌”开关 */
  async setPersonalAccessTokensEnabled(enabled: boolean): Promise<Record<string, unknown>> {
    return this.setBetaFeature('personal_access_tokens', enabled);
  }

  /** 改“为 Codex CLI 启用设备代码身份验证”开关 */
  async setCodexDeviceCodeAuthEnabled(enabled: boolean): Promise<Record<string, unknown>> {
    return this.setBetaFeature('codex_device_code_auth', enabled);
  }

  /** 改“允许成员远程发现并控制设备”开关 */
  async setCodexRemoteControlEnabled(enabled: boolean): Promise<Record<string, unknown>> {
    return this.setBetaFeature('codex_remote_control', enabled);
  }

  private async setBetaFeature(feature: string, enabled: boolean): Promise<Record<string, unknown>> {
    const path = `/backend-api/accounts/${this.account.accountId}/beta_features`;
    return this.request('POST', path, { feature, value: enabled });
  }

  /** 创建 Codex 本地访问所需的个人访问令牌。 */
  async createCodexPersonalAccessToken(input: {
    name: string;
    scopes: string[];
    ttl: number;
  }): Promise<CodexPersonalAccessTokenResponse> {
    const path = '/backend-api/wham/auth-credentials';
    return this.request<CodexPersonalAccessTokenResponse>('POST', path, input);
  }

  /** 改 workspace 名称 */
  async renameWorkspace(name: string): Promise<unknown> {
    const path = `/backend-api/accounts/${this.account.accountId}`;
    return this.request('PATCH', path, { name });
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readRenewalDate(entry: Record<string, unknown>): string | undefined {
  const entitlement = entry.entitlement;
  if (!entitlement || typeof entitlement !== 'object') return undefined;
  const renewsAt = readString((entitlement as Record<string, unknown>).renews_at);
  if (!renewsAt) return undefined;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(renewsAt);
  return match?.[1];
}

interface RawMember {
  id: string;
  email: string;
  name?: string;
  role: MemberRole;
  seat_type?: string;
  status?: string;
}

interface RawPendingInvite {
  id: string;
  email_address: string;
  role: MemberRole;
  status: number;
  seat_type: string;
  created_time: string;
  is_scim_managed: boolean;
}

export interface ChatGptMemberRemovalResponse {
  success?: boolean;
  billing_notice?: unknown;
  policy_notice?: unknown;
}

export function parseChatGptAccountCheckEntries(data: Record<string, unknown>): ChatGptAccountCheckEntry[] {
  const seen = new Set<string>();
  const entries: ChatGptAccountCheckEntry[] = [];
  const accounts =
    data.accounts && typeof data.accounts === 'object' && !Array.isArray(data.accounts)
      ? data.accounts as Record<string, { account?: Record<string, unknown>; can_access_with_session?: unknown }>
      : {};
  for (const [key, value] of Object.entries(accounts)) {
    const entry = value?.account ?? {};
    const accountId = readString(entry.account_id) ?? key;
    if (!accountId || seen.has(accountId)) continue;
    seen.add(accountId);
    entries.push({
      accountId,
      role: readString(entry.account_user_role) as MemberRole | undefined,
      workspaceName: readString(entry.name),
      nextRenewalOn: readRenewalDate(value as Record<string, unknown>),
      planType: readString(entry.plan_type),
      structure: readString(entry.structure),
      canAccessWithSession:
        typeof value?.can_access_with_session === 'boolean' ? value.can_access_with_session : undefined
    });
  }
  return entries;
}

export class ChatGptApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly context: string
  ) {
    super(`backend-api ${status} @ ${context}: ${body.slice(0, 200)}`);
    this.name = 'ChatGptApiError';
  }
}

function isMissingUpcomingInvoice(error: unknown): boolean {
  if (!(error instanceof ChatGptApiError)) return false;
  if (error.status === 404) return true;
  if (error.status !== 500) return false;
  try {
    const body = JSON.parse(error.body) as { detail?: unknown };
    return body.detail === 'Error fetching upcoming invoice';
  } catch {
    return false;
  }
}

function isTokenInvalidatedResponse(body: string): boolean {
  try {
    const data = JSON.parse(body) as { error?: { code?: unknown; message?: unknown } };
    const code = typeof data.error?.code === 'string' ? data.error.code : '';
    const message = typeof data.error?.message === 'string' ? data.error.message : '';
    return (
      code === 'token_invalidated' ||
      code === 'token_revoked' ||
      /authentication token has been invalidated|invalidated oauth token|token has been revoked/i.test(message)
    );
  } catch {
    return /authentication token has been invalidated|invalidated oauth token|token has been revoked|token_invalidated|token_revoked/i.test(body);
  }
}

/** 解 JWT exp，判断是否需要刷新（剩余 ≤ 24h） */
export function tokenNeedsRefresh(accessToken: string): boolean {
  const exp = decodeJwtExp(accessToken);
  if (exp === null) return false;
  const now = Math.floor(Date.now() / 1000);
  return exp - now <= REFRESH_SKEW_SECONDS;
}

export function decodeJwtExp(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

/** 用 refresh_token 换新 access_token */
export async function refreshAccessToken(refreshToken: string): Promise<RefreshResult> {
  const res = await fetchWithRawTrace('openai-oauth', OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': DEFAULT_UA
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: OAUTH_CLIENT_ID
    }).toString()
  });
  if (!res.ok) {
    throw new Error(`token 刷新失败 ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as { access_token?: string; refresh_token?: string };
  if (!data.access_token) throw new Error('token 刷新响应无 access_token');
  return { accessToken: data.access_token, refreshToken: data.refresh_token };
}
