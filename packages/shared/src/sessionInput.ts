export interface ChatGptSessionInput {
  user: {
    email: string;
  };
  account: {
    id: string;
  };
  accessToken: string;
  sessionToken?: string;
}

export type ChatGptSessionParseResult = ChatGptSessionInput | { error: string };

export type ChatGptSessionImportParseResult =
  | { type: 'workspace_session'; session: ChatGptSessionInput }
  | { error: string };

export interface ChatGptSessionInputInspection {
  type: 'workspace_session' | 'invalid';
  message: string;
  email?: string;
  accountId?: string;
  hasSessionToken?: boolean;
  allowsCrossWorkspace?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readSessionToken(record: Record<string, unknown>): string | undefined {
  const value = readString(record, 'sessionToken');
  if (!value || /[;\r\n]/.test(value)) return undefined;
  return value;
}

export function parseChatGptSessionInput(raw: unknown): ChatGptSessionParseResult {
  if (Array.isArray(raw)) return { error: '只支持 chatgpt.com session JSON，不支持数组输入' };
  if (!isRecord(raw)) return { error: '录入内容不是有效 JSON 对象' };

  const user = raw.user;
  if (!isRecord(user)) return { error: '缺少 user.email' };
  const email = readString(user, 'email');
  if (!email) return { error: '缺少 user.email' };

  const account = raw.account;
  if (!isRecord(account)) return { error: '缺少 account.id' };
  const accountId = readString(account, 'id');
  if (!accountId) return { error: '缺少 account.id' };

  const accessToken = readString(raw, 'accessToken');
  if (!accessToken) return { error: '缺少 accessToken' };

  const sessionToken = readSessionToken(raw);
  return {
    user: { email },
    account: { id: accountId },
    accessToken,
    ...(sessionToken ? { sessionToken } : {})
  };
}

export function parseChatGptSessionImportInput(raw: unknown): ChatGptSessionImportParseResult {
  const session = parseChatGptSessionInput(raw);
  if ('error' in session) return session;
  return { type: 'workspace_session', session };
}

export function inspectChatGptSessionImportInput(raw: unknown): ChatGptSessionInputInspection {
  const parsed = parseChatGptSessionImportInput(raw);
  if ('error' in parsed) {
    return { type: 'invalid', message: parsed.error };
  }
  return {
    type: 'workspace_session',
    message: parsed.session.sessionToken
      ? '识别到含 sessionToken 的 session JSON，将允许跨 workspace 操作'
      : '识别到绑定了 workspace 的 session',
    email: parsed.session.user.email,
    accountId: parsed.session.account.id,
    hasSessionToken: Boolean(parsed.session.sessionToken),
    allowsCrossWorkspace: Boolean(parsed.session.sessionToken)
  };
}

export function getChatGptSessionUserEmail(raw: unknown): string | undefined {
  const session = parseChatGptSessionInput(raw);
  if ('error' in session) return undefined;
  return session.user.email;
}
