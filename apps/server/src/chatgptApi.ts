import { randomUUID } from 'node:crypto';
import type { Account, Member, PendingInvite, SeatType, MemberRole } from '@team-manager/shared';
import type { Transport } from './transport.js';

const OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const OAUTH_CLIENT_ID = 'app_2SKx67EdpoN0G6j64rFvigXD';
const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const REFRESH_SKEW_SECONDS = 24 * 60 * 60;

export interface RefreshResult {
  accessToken: string;
  refreshToken?: string;
}

/**
 * ChatGPT 网页 backend-api 薄封装。
 * 阶段一实测：所有请求必须带 Authorization: Bearer；workspace 操作还需 chatgpt-account-id。
 * 请求通过 Transport 发出，部署默认由 curl_cffi sidecar 处理 Cloudflare/TLS 指纹。
 */
export class ChatGptApi {
  constructor(
    private readonly account: Account,
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
    const extra: Record<string, string> = {};
    let payload: string | undefined;
    if (body !== undefined) {
      extra['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await this.transport.fetch({
      method,
      path,
      headers: this.headers(path, extra),
      body: payload
    });
    if (res.status < 200 || res.status >= 300) {
      throw new ChatGptApiError(res.status, res.body, `${method} ${path}`);
    }
    return (res.body ? JSON.parse(res.body) : {}) as T;
  }

  /** 母号状态：从 accounts/check 取本 workspace 那条 */
  async checkAccount(): Promise<{ planType?: string; role?: MemberRole; workspaceName?: string }> {
    const path = '/backend-api/accounts/check/v4-2023-04-27?timezone_offset_min=-480';
    const data = await this.request<{ accounts?: Record<string, { account?: Record<string, unknown> }> }>(
      'GET',
      path
    );
    const accounts = data.accounts ?? {};
    const entry = accounts[this.account.accountId]?.account;
    if (!entry) return {};
    return {
      planType: entry.plan_type as string | undefined,
      role: entry.account_user_role as MemberRole | undefined,
      workspaceName: entry.name as string | undefined
    };
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
          name: u.name,
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

  /** 踢人 */
  async removeMember(userId: string): Promise<unknown> {
    const path = `/backend-api/accounts/${this.account.accountId}/users/${userId}`;
    return this.request('DELETE', path);
  }

  /** 改子号席位类型（字段为 seat_type：default=ChatGPT，usage_based=Codex） */
  async setMemberSeat(userId: string, seat: SeatType): Promise<unknown> {
    const path = `/backend-api/accounts/${this.account.accountId}/users/${userId}`;
    return this.request('PATCH', path, { seat_type: seat });
  }

  /** 读 workspace 设置（含 default_seat_type） */
  async getSettings(): Promise<Record<string, unknown>> {
    const path = `/backend-api/accounts/${this.account.accountId}/settings`;
    return this.request('GET', path);
  }

  /** 改新成员默认席位类型 */
  async setDefaultSeat(seat: SeatType): Promise<unknown> {
    const path = `/backend-api/accounts/${this.account.accountId}/settings/default_seat_type`;
    return this.request('POST', path, { value: seat });
  }

  /** 改 workspace 名称 */
  async renameWorkspace(name: string): Promise<unknown> {
    const path = `/backend-api/accounts/${this.account.accountId}`;
    return this.request('PATCH', path, { name });
  }
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
  const res = await fetch(OAUTH_TOKEN_URL, {
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
