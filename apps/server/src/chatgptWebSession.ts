import {
  parseChatGptSessionImportInput,
  parseChatGptSessionInput,
  type ChatGptSessionCookie,
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

export async function resolveChatGptSessionImportInput(
  raw: unknown,
  transport: Transport
): Promise<{ type: 'workspace_session' | 'browser_cookies'; session: ChatGptSessionInput }> {
  const parsed = parseChatGptSessionImportInput(raw);
  if ('error' in parsed) throw new ChatGptWebSessionError(400, parsed.error);
  if (parsed.type === 'browser_cookies') {
    return {
      type: parsed.type,
      session: await fetchCurrentWebSessionFromCookies(transport, parsed.cookies)
    };
  }
  return { type: parsed.type, session: parsed.session };
}

export async function fetchWorkspaceWebAccessTokenFromCookies(
  transport: Transport,
  cookies: ChatGptSessionCookie[],
  targetChatgptAccountId: string
): Promise<string> {
  const response = await transport.fetch({
    method: 'GET',
    path: `/api/auth/session?team_manager_workspace=${encodeURIComponent(targetChatgptAccountId)}&t=${Date.now()}`,
    headers: {
      accept: 'application/json',
      cookie: buildChatGptSessionCookieHeader(cookies, targetChatgptAccountId),
      'user-agent': CHATGPT_WEB_USER_AGENT
    }
  });
  if (response.status < 200 || response.status >= 300) {
    throw new ChatGptWebSessionError(
      response.status >= 400 && response.status < 500 ? response.status : 502,
      `获取目标 workspace Web session 失败: HTTP ${response.status} ${trimForLog(response.body)}`
    );
  }
  const data = parseJsonObject(response.body, '获取目标 workspace Web session 返回不是 JSON');
  const accessToken = readOptionalString(data, 'accessToken') ?? readOptionalString(data, 'access_token');
  if (!accessToken) throw new ChatGptWebSessionError(502, '目标 workspace Web session 响应缺少 accessToken');
  const claims = chatGptAuthClaimsFromAccessToken(accessToken);
  if (claims.chatgptAccountId !== targetChatgptAccountId) {
    throw new ChatGptWebSessionError(
      409,
      `目标 workspace Web session 与目标不一致：目标 ${targetChatgptAccountId}，实际 ${claims.chatgptAccountId || '空'}`
    );
  }
  return accessToken;
}

async function fetchCurrentWebSessionFromCookies(
  transport: Transport,
  cookies: ChatGptSessionCookie[]
): Promise<ChatGptSessionInput> {
  const response = await transport.fetch({
    method: 'GET',
    path: `/api/auth/session?team_manager_import=browser_cookies&t=${Date.now()}`,
    headers: {
      accept: 'application/json',
      cookie: buildChatGptSessionCookieHeader(cookies),
      'user-agent': CHATGPT_WEB_USER_AGENT
    }
  });
  if (response.status < 200 || response.status >= 300) {
    throw new ChatGptWebSessionError(
      response.status >= 400 && response.status < 500 ? response.status : 502,
      `获取浏览器 cookies Web session 失败: HTTP ${response.status} ${trimForLog(response.body)}`
    );
  }
  const data = parseJsonObject(response.body, '浏览器 cookies Web session 返回不是 JSON');
  const session = parseChatGptSessionInput({ ...data, cookies });
  if ('error' in session) {
    throw new ChatGptWebSessionError(502, `浏览器 cookies Web session 响应无效: ${session.error}`);
  }
  const claims = chatGptAuthClaimsFromAccessToken(session.accessToken);
  if (claims.chatgptAccountId && claims.chatgptAccountId !== session.account.id) {
    throw new ChatGptWebSessionError(
      409,
      `浏览器 cookies Web session 与响应 workspace 不一致：响应 ${session.account.id}，实际 ${claims.chatgptAccountId}`
    );
  }
  return session;
}

function buildChatGptSessionCookieHeader(cookies: ChatGptSessionCookie[], targetChatgptAccountId?: string): string {
  const pairs = cookies
    .filter((cookie) => {
      if (!targetChatgptAccountId) return true;
      return cookie.name !== '_account' && cookie.name !== '_account_residency_region';
    })
    .filter((cookie) => cookie.name && cookie.value && !/[;\s]/.test(cookie.name) && !cookie.value.includes(';'))
    .map((cookie) => `${cookie.name}=${cookie.value}`);
  if (targetChatgptAccountId) {
    pairs.push(`_account=${targetChatgptAccountId}`);
    pairs.push('_account_residency_region=no_constraint');
  }
  return pairs.join('; ');
}

function parseJsonObject(body: string, message: string): Record<string, unknown> {
  try {
    const data = JSON.parse(body) as unknown;
    return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  } catch {
    throw new ChatGptWebSessionError(502, message);
  }
}

function chatGptAuthClaimsFromAccessToken(accessToken: string): { chatgptAccountId?: string; planType?: string } {
  const parts = accessToken.split('.');
  if (parts.length < 2) return {};
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as Record<string, unknown>;
    const auth = payload['https://api.openai.com/auth'];
    if (!auth || typeof auth !== 'object') return {};
    const record = auth as Record<string, unknown>;
    return {
      chatgptAccountId: readOptionalString(record, 'chatgpt_account_id'),
      planType: readOptionalString(record, 'chatgpt_plan_type')
    };
  } catch {
    return {};
  }
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function trimForLog(value: string): string {
  return value.replace(/\s+/g, ' ').slice(0, 200);
}
