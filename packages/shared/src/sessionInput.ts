export interface ChatGptSessionInput {
  user: {
    email: string;
  };
  account: {
    id: string;
  };
  accessToken: string;
}

export type ChatGptSessionParseResult = ChatGptSessionInput | { error: string };

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
    accessToken
  };
}

export function getChatGptSessionUserEmail(raw: unknown): string | undefined {
  const session = parseChatGptSessionInput(raw);
  if ('error' in session) return undefined;
  return session.user.email;
}
