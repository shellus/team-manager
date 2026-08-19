import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { CodexCredentialJson } from '@team-manager/shared';
import type { Transport } from './transport.js';
import { upstreamHttpError } from './serviceError.js';

export const CODEX_AUTH_REDIRECT_URI = 'http://localhost:1455/auth/callback';
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTH_URL = 'https://auth.openai.com/oauth/authorize';

export function createCodexAuthSession(loginHint?: string) {
  const codeVerifier = randomBytes(96).toString('base64url'); const state = randomBytes(32).toString('base64url');
  const params = new URLSearchParams({ client_id: CLIENT_ID, response_type: 'code', redirect_uri: CODEX_AUTH_REDIRECT_URI,
    scope: 'openid email profile offline_access', state, code_challenge: createHash('sha256').update(codeVerifier).digest('base64url'),
    code_challenge_method: 'S256', prompt: 'login', id_token_add_organizations: 'true', codex_cli_simplified_flow: 'true' });
  if (loginHint) params.set('login_hint', loginHint);
  return { id: randomUUID(), state, codeVerifier, authUrl: `${AUTH_URL}?${params}`, expiresAt: Date.now() + 5 * 60_000 };
}

export async function exchangeCodexCallback(input: { callbackUrl: string; state: string; codeVerifier: string; transport: Transport; proxy?: string }) {
  const url = new URL(input.callbackUrl); const expected = new URL(CODEX_AUTH_REDIRECT_URI);
  if (url.origin !== expected.origin || url.pathname !== expected.pathname) throw new Error(`回调 URL 必须以 ${CODEX_AUTH_REDIRECT_URI} 开头`);
  if (url.searchParams.get('state') !== input.state) throw new Error('Codex Auth state 不匹配');
  const code = url.searchParams.get('code'); if (!code) throw new Error(url.searchParams.get('error_description') || '回调 URL 缺少 code');
  const response = await input.transport.fetch({ method: 'POST', baseUrl: 'https://auth.openai.com', path: '/oauth/token', upstream: 'codex-oauth-token-exchange',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, proxy: input.proxy,
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: CLIENT_ID, code, redirect_uri: CODEX_AUTH_REDIRECT_URI, code_verifier: input.codeVerifier }).toString() });
  if (response.status < 200 || response.status >= 300) {
    throw upstreamHttpError(response.status, `Codex token exchange 失败: HTTP ${response.status} ${response.body.slice(0, 200)}`);
  }
  const token = JSON.parse(response.body) as Record<string, unknown>;
  if (typeof token.access_token !== 'string' || typeof token.refresh_token !== 'string' || typeof token.id_token !== 'string') throw new Error('Codex token response 缺少 token');
  const claims = decodeJwt(token.id_token); const auth = record(claims['https://api.openai.com/auth']); const expires = Number(token.expires_in);
  return { id_token: token.id_token, access_token: token.access_token, refresh_token: token.refresh_token,
    account_id: text(auth?.chatgpt_account_id), email: text(claims.email), type: 'codex', last_refresh: new Date().toISOString(),
    expired: new Date(Date.now() + (Number.isFinite(expires) ? expires : 0) * 1000).toISOString(),
    plan_type: text(auth?.chatgpt_plan_type), auth_mode: 'chatgpt', credential_source: 'oauth' } as CodexCredentialJson;
}
function decodeJwt(token: string): Record<string, unknown> { const p = token.split('.')[1]; if (!p) throw new Error('JWT 格式错误'); return JSON.parse(Buffer.from(p, 'base64url').toString()); }
function record(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function text(value: unknown): string { return typeof value === 'string' ? value : ''; }
