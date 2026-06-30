import type { CodexCredentialJson } from '@team-manager/shared';

export function credentialAccessToken(credential: CodexCredentialJson): string {
  const accessToken = credential.access_token.trim();
  if (!accessToken) throw new Error('Codex 凭证缺少 access_token');
  return accessToken;
}
