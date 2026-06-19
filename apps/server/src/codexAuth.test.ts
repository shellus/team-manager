import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CODEX_AUTH_REDIRECT_URI,
  CODEX_AUTH_CLIENT_ID,
  createCodexAuthSession,
  exchangeCodexCallback,
  parseCodexCallbackUrl
} from './codexAuth.js';

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function unsignedJwt(payload: Record<string, unknown>): string {
  return `${base64UrlJson({ alg: 'none', typ: 'JWT' })}.${base64UrlJson(payload)}.signature`;
}

describe('Codex Auth OAuth helpers', () => {
  it('creates a Codex Auth URL with PKCE and the fixed loopback callback', () => {
    const session = createCodexAuthSession({ now: 1781748000000 });
    const url = new URL(session.authUrl);

    assert.equal(url.origin + url.pathname, 'https://auth.openai.com/oauth/authorize');
    assert.equal(url.searchParams.get('client_id'), CODEX_AUTH_CLIENT_ID);
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('redirect_uri'), CODEX_AUTH_REDIRECT_URI);
    assert.equal(url.searchParams.get('scope'), 'openid email profile offline_access');
    assert.equal(url.searchParams.get('state'), session.state);
    assert.equal(url.searchParams.get('code_challenge'), session.codeChallenge);
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('prompt'), 'login');
    assert.equal(url.searchParams.get('id_token_add_organizations'), 'true');
    assert.equal(url.searchParams.get('codex_cli_simplified_flow'), 'true');
    assert.ok(session.codeVerifier.length >= 43);
  });

  it('adds login_hint only when requested', () => {
    const session = createCodexAuthSession({ loginHint: 'child@example.com' });
    const url = new URL(session.authUrl);

    assert.equal(url.searchParams.get('login_hint'), 'child@example.com');
  });

  it('parses pasted callback URLs', () => {
    const parsed = parseCodexCallbackUrl('http://localhost:1455/auth/callback?code=auth-code&state=state-1');

    assert.equal(parsed.code, 'auth-code');
    assert.equal(parsed.state, 'state-1');
  });

  it('exchanges callback code for CPA-compatible Codex credential JSON', async () => {
    const session = createCodexAuthSession({ now: 1781748000000 });
    const idToken = unsignedJwt({
      email: 'child@example.com',
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'chatgpt-account-id',
        chatgpt_plan_type: 'team'
      }
    });
    const requests: Array<{ url: string; body: string }> = [];
    const fakeFetch = async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), body: String(init?.body ?? '') });
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            access_token: 'access-token',
            refresh_token: 'refresh-token',
            id_token: idToken,
            expires_in: 3600
          })
      } as Response;
    };

    const credential = await exchangeCodexCallback({
      callbackUrl: `${CODEX_AUTH_REDIRECT_URI}?code=auth-code&state=${session.state}`,
      session,
      now: new Date('2026-06-18T00:00:00.000Z'),
      fetchImpl: fakeFetch as typeof fetch
    });

    assert.equal(credential.type, 'codex');
    assert.equal(credential.email, 'child@example.com');
    assert.equal(credential.account_id, 'chatgpt-account-id');
    assert.equal(credential.access_token, 'access-token');
    assert.equal(credential.refresh_token, 'refresh-token');
    assert.equal(credential.id_token, idToken);
    assert.equal(credential.last_refresh, '2026-06-18T00:00:00.000Z');
    assert.equal(credential.expired, '2026-06-18T01:00:00.000Z');
    assert.equal(credential.plan_type, 'team');

    const body = new URLSearchParams(requests[0]!.body);
    assert.equal(body.get('grant_type'), 'authorization_code');
    assert.equal(body.get('client_id'), CODEX_AUTH_CLIENT_ID);
    assert.equal(body.get('code'), 'auth-code');
    assert.equal(body.get('redirect_uri'), CODEX_AUTH_REDIRECT_URI);
    assert.equal(body.get('code_verifier'), session.codeVerifier);
  });

  it('rejects callbacks with mismatched state', async () => {
    const session = createCodexAuthSession({ now: 1781748000000 });

    await assert.rejects(
      () =>
        exchangeCodexCallback({
          callbackUrl: `${CODEX_AUTH_REDIRECT_URI}?code=auth-code&state=wrong-state`,
          session,
          fetchImpl: (async () => {
            throw new Error('fetch should not be called');
          }) as typeof fetch
        }),
      /state 不匹配/
    );
  });
});
