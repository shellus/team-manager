import { parseChatGptSessionInput, type Account } from '@team-manager/shared';

/**
 * 把录入 JSON 规范化成内部 Account 字段。
 * 只支持 chatgpt.com session JSON：{ accessToken, account:{id}, user:{email} }。
 */
export function normalizeAccountInput(raw: unknown): Omit<Account, 'id'> | { error: string } {
  const session = parseChatGptSessionInput(raw);
  if ('error' in session) return session;

  return {
    label: session.user.email,
    accountId: session.account.id,
    email: session.user.email,
    accessToken: session.accessToken
  };
}
