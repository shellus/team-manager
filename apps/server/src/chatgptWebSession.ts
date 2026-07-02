import {
  parseChatGptSessionImportInput,
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
  _transport: Transport
): Promise<{ type: 'workspace_session'; session: ChatGptSessionInput }> {
  const parsed = parseChatGptSessionImportInput(raw);
  if ('error' in parsed) throw new ChatGptWebSessionError(400, parsed.error);
  return parsed;
}

export async function fetchWorkspaceWebAccessTokenFromSessionToken(
  transport: Transport,
  sessionToken: string,
  targetChatgptAccountId: string
): Promise<string> {
  const response = await transport.fetch({
    method: 'GET',
    path: `/api/auth/session?team_manager_workspace=${encodeURIComponent(targetChatgptAccountId)}&t=${Date.now()}`,
    headers: {
      accept: 'application/json',
      cookie: buildSessionTokenHeader(sessionToken, targetChatgptAccountId),
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
