import {
  parseChatGptSessionImportInput,
  type ChatGptWebSessionCookies,
  type ChatGptSessionInput
} from '@team-manager/shared';
import type { Transport } from './transport.js';

const CHATGPT_WEB_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';

export class ChatGptWebSessionError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'ChatGptWebSessionError';
  }
}

export interface ChatGptWorkspaceSession {
  accessToken: string;
  accountId: string;
  email?: string;
  userId?: string;
  planType?: string;
  expiresAt?: number;
  idToken?: string;
  refreshToken?: string;
}

export async function resolveChatGptSessionImportInput(
  raw: unknown,
  _transport: Transport
): Promise<{ type: 'workspace_session'; session: ChatGptSessionInput }> {
  const parsed = parseChatGptSessionImportInput(raw);
  if ('error' in parsed) throw new ChatGptWebSessionError(400, parsed.error);
  return parsed;
}

export async function fetchWorkspaceWebAccessTokenFromSessionToken(
  transport: Transport,
  sessionToken: string,
  targetChatgptAccountId: string,
  proxy?: string
): Promise<string> {
  return fetchChatGptWebAccessTokenFromSessionToken(transport, sessionToken, targetChatgptAccountId, proxy);
}

export async function fetchChatGptWebAccessTokenFromSessionToken(
  transport: Transport,
  sessionToken: string,
  targetChatgptAccountId: string,
  proxy?: string
): Promise<string> {
  const data = await fetchWorkspaceWebSessionFromSessionToken(transport, sessionToken, targetChatgptAccountId, proxy);
  const accessToken = readWorkspaceSessionAccessToken(data);
  if (!accessToken) throw new ChatGptWebSessionError(502, '目标 workspace Web session 响应缺少 accessToken');
  return accessToken;
}

export async function fetchWorkspaceWebSessionFromSessionToken(
  transport: Transport,
  sessionToken: string,
  targetChatgptAccountId: string,
  proxy?: string
): Promise<Record<string, unknown>> {
  return fetchWorkspaceWebSessionWithCookies(
    transport,
    buildSessionTokenHeader(sessionToken, targetChatgptAccountId),
    targetChatgptAccountId,
    proxy
  );
}

export async function fetchWorkspaceWebSessionFromStoredCookies(
  transport: Transport,
  sessionToken: string,
  cookies: ChatGptWebSessionCookies,
  targetChatgptAccountId: string,
  proxy?: string
): Promise<Record<string, unknown>> {
  return fetchWorkspaceWebSessionWithCookies(
    transport,
    buildStoredSessionCookieHeader(sessionToken, cookies, targetChatgptAccountId),
    targetChatgptAccountId,
    proxy
  );
}

async function fetchWorkspaceWebSessionWithCookies(
  transport: Transport,
  cookie: string,
  targetChatgptAccountId: string,
  proxy?: string
): Promise<Record<string, unknown>> {
  const response = await transport.fetch({
    method: 'GET',
    path: `/api/auth/session?team_manager_workspace=${encodeURIComponent(targetChatgptAccountId)}&t=${Date.now()}`,
    headers: {
      accept: 'application/json',
      cookie,
      'user-agent': CHATGPT_WEB_USER_AGENT
    },
    proxy: proxy?.trim() || undefined
  });
  if (response.status < 200 || response.status >= 300) {
    throw new ChatGptWebSessionError(
      response.status >= 400 && response.status < 500 ? response.status : 502,
      `获取目标 workspace Web session 失败: HTTP ${response.status} ${trimForLog(response.body)}`
    );
  }
  const data = parseJsonObject(response.body, '获取目标 workspace Web session 返回不是 JSON');
  const accessToken = readWorkspaceSessionAccessToken(data);
  if (!accessToken) throw new ChatGptWebSessionError(502, '目标 workspace Web session 响应缺少 accessToken');
  const claims = chatGptAuthClaimsFromAccessToken(accessToken);
  if (claims.chatgptAccountId !== targetChatgptAccountId) {
    throw new ChatGptWebSessionError(
      409,
      `目标 workspace Web session 与目标不一致：目标 ${targetChatgptAccountId}，实际 ${claims.chatgptAccountId || '空'}`
    );
  }
  return data;
}

export async function fetchWorkspaceExchangeSessionFromSessionToken(
  transport: Transport,
  sessionToken: string,
  targetChatgptAccountId: string,
  proxy?: string
): Promise<ChatGptWorkspaceSession> {
  const response = await transport.fetch({
    method: 'GET',
    path:
      `/api/auth/session?exchange_workspace_token=true&workspace_id=${encodeURIComponent(targetChatgptAccountId)}` +
      '&reason=setCurrentAccount',
    headers: {
      accept: '*/*',
      cookie: buildSessionTokenHeader(sessionToken, targetChatgptAccountId),
      'user-agent': CHATGPT_WEB_USER_AGENT
    },
    proxy: proxy?.trim() || undefined
  });
  if (response.status < 200 || response.status >= 300) {
    throw new ChatGptWebSessionError(
      response.status >= 400 && response.status < 500 ? response.status : 502,
      `获取目标 workspace Web session 失败: HTTP ${response.status} ${trimForLog(response.body)}`
    );
  }
  const data = parseJsonObject(response.body, '获取目标 workspace Web session 返回不是 JSON');
  const accessToken =
    readOptionalString(data, 'accessToken') ??
    readOptionalString(data, 'access_token') ??
    readNestedOptionalString(data, ['tokens', 'access_token']);
  if (!accessToken) throw new ChatGptWebSessionError(502, '目标 workspace Web session 响应缺少 accessToken');

  const claims = chatGptAuthClaimsFromAccessToken(accessToken);
  if (claims.chatgptAccountId !== targetChatgptAccountId) {
    throw new ChatGptWebSessionError(
      409,
      `目标 workspace Web session 与目标不一致：目标 ${targetChatgptAccountId}，实际 ${claims.chatgptAccountId || '空'}`
    );
  }

  const user = data.user && typeof data.user === 'object' ? (data.user as Record<string, unknown>) : {};
  return {
    accessToken,
    accountId: targetChatgptAccountId,
    email: readOptionalString(user, 'email') ?? readOptionalString(data, 'email') ?? claims.email,
    userId:
      readOptionalString(user, 'id') ??
      readOptionalString(data, 'chatgpt_user_id') ??
      readOptionalString(data, 'userId') ??
      claims.userId,
    planType:
      readOptionalString(data, 'plan_type') ??
      readNestedOptionalString(data, ['account', 'plan_type']) ??
      readNestedOptionalString(data, ['account', 'planType']) ??
      claims.planType,
    expiresAt: readEpochSeconds(data, 'expiresAt') ?? readEpochSeconds(data, 'expires') ?? claims.expiresAt,
    idToken:
      readOptionalString(data, 'idToken') ??
      readOptionalString(data, 'id_token') ??
      readNestedOptionalString(data, ['tokens', 'id_token']) ??
      readNestedOptionalString(data, ['tokens', 'idToken']),
    refreshToken:
      readOptionalString(data, 'refreshToken') ??
      readOptionalString(data, 'refresh_token') ??
      readNestedOptionalString(data, ['tokens', 'refresh_token'])
  };
}

function buildSessionTokenHeader(sessionToken: string, targetChatgptAccountId: string): string {
  const trimmed = sessionToken.trim();
  if (!trimmed || /[;\r\n]/.test(trimmed)) {
    throw new ChatGptWebSessionError(400, 'sessionToken 无效，无法换取目标 workspace Web session');
  }
  return [
    `__Secure-next-auth.session-token=${trimmed}`,
    `_account=${targetChatgptAccountId}`,
    '_account_residency_region=no_constraint'
  ].join('; ');
}

function buildStoredSessionCookieHeader(
  sessionToken: string,
  cookies: ChatGptWebSessionCookies,
  targetChatgptAccountId: string
): string {
  const base = buildSessionTokenHeader(sessionToken, targetChatgptAccountId).split('; ');
  const values: Array<[string, string | undefined]> = [
    ['oai-did', cookies.oaiDid],
    ['oai-client-auth-info', cookies.clientAuthInfo],
    ['_puid', cookies.puid],
    ['__Secure-oai-is', cookies.oaiIs]
  ];
  for (const [name, value] of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    if (/[;\r\n]/.test(trimmed)) {
      throw new ChatGptWebSessionError(400, `${name} Cookie 无效`);
    }
    base.push(`${name}=${trimmed}`);
  }
  return base.join('; ');
}

function parseJsonObject(body: string, message: string): Record<string, unknown> {
  try {
    const data = JSON.parse(body) as unknown;
    return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  } catch {
    throw new ChatGptWebSessionError(502, message);
  }
}

function chatGptAuthClaimsFromAccessToken(accessToken: string): {
  chatgptAccountId?: string;
  planType?: string;
  userId?: string;
  email?: string;
  expiresAt?: number;
} {
  const parts = accessToken.split('.');
  if (parts.length < 2) return {};
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as Record<string, unknown>;
    const auth = payload['https://api.openai.com/auth'];
    if (!auth || typeof auth !== 'object') return {};
    const record = auth as Record<string, unknown>;
    return {
      chatgptAccountId: readOptionalString(record, 'chatgpt_account_id'),
      planType: readOptionalString(record, 'chatgpt_plan_type'),
      userId: readOptionalString(record, 'chatgpt_user_id') ?? readOptionalString(record, 'user_id'),
      email: readOptionalString(payload, 'email'),
      expiresAt: typeof payload.exp === 'number' && Number.isFinite(payload.exp) ? Math.trunc(payload.exp) : undefined
    };
  } catch {
    return {};
  }
}

function readNestedOptionalString(record: Record<string, unknown>, path: string[]): string | undefined {
  let current: unknown = record;
  for (const key of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'string' && current.trim() ? current.trim() : undefined;
}

function readEpochSeconds(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value > 1e11 ? value / 1000 : value);
  }
  if (typeof value === 'string' && value.trim()) {
    const parsedNumber = Number(value);
    if (Number.isFinite(parsedNumber)) return Math.trunc(parsedNumber > 1e11 ? parsedNumber / 1000 : parsedNumber);
    const parsedDate = Date.parse(value);
    if (Number.isFinite(parsedDate)) return Math.trunc(parsedDate / 1000);
  }
  return undefined;
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readWorkspaceSessionAccessToken(data: Record<string, unknown>): string | undefined {
  return (
    readOptionalString(data, 'accessToken') ??
    readOptionalString(data, 'access_token') ??
    readNestedOptionalString(data, ['tokens', 'access_token'])
  );
}

function trimForLog(value: string): string {
  return value.replace(/\s+/g, ' ').slice(0, 200);
}
