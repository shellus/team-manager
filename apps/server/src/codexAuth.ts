import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { CodexOAuthCredentialJson } from '@team-manager/shared';
import { createTransport, type Transport } from './transport.js';

export const CODEX_AUTH_URL = 'https://auth.openai.com/oauth/authorize';
export const CODEX_AUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token';
export const CODEX_AUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
export const CODEX_AUTH_REDIRECT_URI = 'http://localhost:1455/auth/callback';
export const CODEX_AUTH_SCOPE = 'openid email profile offline_access';

export interface CodexAuthSession {
  id: string;
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  authUrl: string;
  createdAt: number;
  expiresAt: number;
}

export interface CreateCodexAuthSessionOptions {
  now?: number;
  loginHint?: string;
}

export interface CodexCallback {
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
}

export interface ExchangeCodexCallbackOptions {
  callbackUrl: string;
  session: CodexAuthSession;
  fetchImpl?: typeof fetch;
  transport?: Transport;
  proxy?: string;
  now?: Date;
}

export interface CodexTokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
}

interface CodexJwtClaims {
  email?: string;
  'https://api.openai.com/auth'?: {
    chatgpt_account_id?: string;
    chatgpt_plan_type?: string;
  };
}

export function createCodexAuthSession(options: CreateCodexAuthSessionOptions = {}): CodexAuthSession {
  const now = options.now ?? Date.now();
  const codeVerifier = randomBytes(96).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  const state = randomBytes(32).toString('base64url');
  const params = new URLSearchParams({
    client_id: CODEX_AUTH_CLIENT_ID,
    response_type: 'code',
    redirect_uri: CODEX_AUTH_REDIRECT_URI,
    scope: CODEX_AUTH_SCOPE,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'login',
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true'
  });
  if (options.loginHint?.trim()) params.set('login_hint', options.loginHint.trim());

  return {
    id: randomUUID(),
    state,
    codeVerifier,
    codeChallenge,
    authUrl: `${CODEX_AUTH_URL}?${params.toString()}`,
    createdAt: now,
    expiresAt: now + 5 * 60 * 1000
  };
}

export function parseCodexCallbackUrl(callbackUrl: string): CodexCallback {
  let url: URL;
  try {
    url = new URL(callbackUrl.trim());
  } catch {
    throw new Error('回调 URL 格式不正确');
  }
  const expected = new URL(CODEX_AUTH_REDIRECT_URI);
  if (url.origin !== expected.origin || url.pathname !== expected.pathname) {
    throw new Error(`回调 URL 必须以 ${CODEX_AUTH_REDIRECT_URI} 开头`);
  }

  return {
    code: valueOrUndefined(url.searchParams.get('code')),
    state: valueOrUndefined(url.searchParams.get('state')),
    error: valueOrUndefined(url.searchParams.get('error')),
    errorDescription: valueOrUndefined(url.searchParams.get('error_description'))
  };
}

export async function exchangeCodexCallback(
  options: ExchangeCodexCallbackOptions
): Promise<CodexOAuthCredentialJson> {
  const parsed = parseCodexCallbackUrl(options.callbackUrl);
  if (parsed.error) throw new Error(parsed.errorDescription ?? parsed.error);
  if (!parsed.code) throw new Error('回调 URL 缺少 code');
  if (!parsed.state) throw new Error('回调 URL 缺少 state');
  if (parsed.state !== options.session.state) throw new Error('Codex Auth state 不匹配');

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CODEX_AUTH_CLIENT_ID,
    code: parsed.code,
    redirect_uri: CODEX_AUTH_REDIRECT_URI,
    code_verifier: options.session.codeVerifier
  }).toString();
  const tokenUrl = new URL(CODEX_AUTH_TOKEN_URL);
  const response = options.fetchImpl
    ? await exchangeWithFetch(options.fetchImpl, body)
    : await (options.transport ?? createTransport()).fetch({
        method: 'POST',
        baseUrl: tokenUrl.origin,
        path: tokenUrl.pathname,
        upstream: 'codex-oauth-token-exchange',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json'
        },
        body,
        proxy: options.proxy
      });
  const text = response.body;
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Codex token exchange 失败: HTTP ${response.status} ${trimForError(text)}`);
  }

  let token: CodexTokenResponse;
  try {
    token = JSON.parse(text) as CodexTokenResponse;
  } catch (error) {
    throw new Error(`Codex token exchange 返回不是 JSON: ${(error as Error).message}`);
  }
  return codexCredentialFromTokenResponse(token, options.now ?? new Date());
}

async function exchangeWithFetch(fetchImpl: typeof fetch, body: string) {
  const response = await fetchImpl(CODEX_AUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    },
    body
  });
  return {
    status: response.status,
    body: await response.text()
  };
}

export function codexCredentialFromTokenResponse(
  token: CodexTokenResponse,
  now: Date = new Date()
): CodexOAuthCredentialJson {
  if (!token.access_token || !token.refresh_token || !token.id_token) {
    throw new Error('Codex token response 缺少 access_token / refresh_token / id_token');
  }
  const claims = decodeJwtPayload<CodexJwtClaims>(token.id_token);
  const auth = claims['https://api.openai.com/auth'];
  const expiresInSeconds = typeof token.expires_in === 'number' && token.expires_in > 0
    ? token.expires_in
    : 0;

  return {
    id_token: token.id_token,
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    account_id: auth?.chatgpt_account_id ?? '',
    last_refresh: now.toISOString(),
    email: claims.email ?? '',
    type: 'codex',
    expired: new Date(now.getTime() + expiresInSeconds * 1000).toISOString(),
    plan_type: auth?.chatgpt_plan_type,
    auth_mode: 'chatgpt',
    credential_source: 'oauth'
  };
}

export function decodeJwtPayload<T>(token: string): T {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) throw new Error('JWT 格式不正确');
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as T;
  } catch (error) {
    throw new Error(`JWT payload 解析失败: ${(error as Error).message}`);
  }
}

function valueOrUndefined(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function trimForError(value: string): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length > 180 ? `${trimmed.slice(0, 180)}...` : trimmed;
}
