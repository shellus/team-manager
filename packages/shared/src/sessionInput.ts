export interface ChatGptSessionInput {
  user: {
    email: string;
  };
  account: {
    id: string;
  };
  accessToken: string;
  cookies?: ChatGptSessionCookie[];
}

export interface ChatGptSessionCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  expires?: number;
  sameSite?: string;
}

export type ChatGptSessionParseResult = ChatGptSessionInput | { error: string };

export type ChatGptSessionImportParseResult =
  | { type: 'workspace_session'; session: ChatGptSessionInput }
  | { type: 'browser_cookies'; cookies: ChatGptSessionCookie[] }
  | { error: string };

export interface ChatGptSessionInputInspection {
  type: 'workspace_session' | 'browser_cookies' | 'invalid';
  message: string;
  email?: string;
  accountId?: string;
  cookieCount?: number;
  hasSessionTokenCookie?: boolean;
  allowsCrossWorkspace?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function parseChatGptSessionInput(raw: unknown): ChatGptSessionParseResult {
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

  return {
    user: { email },
    account: { id: accountId },
    accessToken,
    cookies: parseCookies(raw.cookies)
  };
}

export function parseChatGptSessionImportInput(raw: unknown): ChatGptSessionImportParseResult {
  if (Array.isArray(raw)) {
    const cookies = parseCookies(raw);
    if (!cookies) return { error: '浏览器 cookies 为空或没有有效 name/value' };
    if (!hasChatGptSessionTokenCookie(cookies)) {
      return { error: '浏览器 cookies 缺少 __Secure-next-auth.session-token' };
    }
    return { type: 'browser_cookies', cookies };
  }

  if (isRecord(raw) && raw.cookies !== undefined) {
    return { error: 'session JSON 和浏览器 cookies 数组需要作为互斥输入；请直接粘贴 cookies 数组' };
  }

  const session = parseChatGptSessionInput(raw);
  if ('error' in session) return session;
  return { type: 'workspace_session', session };
}

export function inspectChatGptSessionImportInput(raw: unknown): ChatGptSessionInputInspection {
  const parsed = parseChatGptSessionImportInput(raw);
  if ('error' in parsed) {
    return { type: 'invalid', message: parsed.error };
  }
  if (parsed.type === 'browser_cookies') {
    return {
      type: 'browser_cookies',
      message: '识别到浏览器导出 cookies，将允许跨 workspace 操作',
      cookieCount: parsed.cookies.length,
      hasSessionTokenCookie: true,
      allowsCrossWorkspace: true
    };
  }
  return {
    type: 'workspace_session',
    message: '识别到绑定了 workspace 的 session',
    email: parsed.session.user.email,
    accountId: parsed.session.account.id,
    cookieCount: parsed.session.cookies?.length,
    hasSessionTokenCookie: parsed.session.cookies ? hasChatGptSessionTokenCookie(parsed.session.cookies) : false,
    allowsCrossWorkspace: false
  };
}

export function getChatGptSessionUserEmail(raw: unknown): string | undefined {
  const session = parseChatGptSessionInput(raw);
  if ('error' in session) return undefined;
  return session.user.email;
}

export function hasChatGptSessionTokenCookie(cookies: ChatGptSessionCookie[]): boolean {
  return cookies.some((cookie) => /^__Secure-next-auth\.session-token(?:\.\d+)?$/.test(cookie.name));
}

function parseCookies(value: unknown): ChatGptSessionCookie[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const cookies: ChatGptSessionCookie[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const name = readString(item, 'name');
    const cookieValue = readString(item, 'value');
    if (!name || !cookieValue || /[;\s]/.test(name)) continue;
    cookies.push({
      name,
      value: cookieValue,
      domain: readString(item, 'domain'),
      path: readString(item, 'path'),
      httpOnly: typeof item.httpOnly === 'boolean' ? item.httpOnly : undefined,
      secure: typeof item.secure === 'boolean' ? item.secure : undefined,
      expires: typeof item.expires === 'number' ? item.expires : undefined,
      sameSite: readString(item, 'sameSite')
    });
  }
  return cookies.length ? cookies : undefined;
}
