import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { HttpRequest, Transport } from './transport.js';
import {
  CODEX_AUTH_CLIENT_ID,
  CODEX_AUTH_REDIRECT_URI,
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
    const session = createCodexAuthSession({ now: 1781748000000, loginHint: 'child@example.com' });
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
    assert.equal(url.searchParams.get('login_hint'), 'child@example.com');
    assert.ok(session.codeVerifier.length >= 43);
  });

  it('parses pasted callback URLs', () => {
    assert.deepEqual(
      parseCodexCallbackUrl('http://localhost:1455/auth/callback?code=auth-code&state=state-1'),
      { code: 'auth-code', state: 'state-1', error: undefined, errorDescription: undefined }
    );
  });

  it('rejects callback URLs from a different origin or path', () => {
    assert.throws(
      () => parseCodexCallbackUrl('https://example.com/auth/callback?code=a&state=b'),
      /必须以 http:\/\/localhost:1455\/auth\/callback 开头/
    );
  });

  it('exchanges the callback for an OAuth credential', async () => {
    const session = createCodexAuthSession({ now: 1781748000000 });
    const idToken = unsignedJwt({
      email: 'child@example.com',
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'workspace-account-id',
        chatgpt_plan_type: 'team'
      }
    });
    const requests: Array<{ url: string; body: string }> = [];
    const fakeFetch = async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), body: String(init?.body ?? '') });
      return new Response(JSON.stringify({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        id_token: idToken,
        expires_in: 3600
      }), { status: 200 });
    };

    const credential = await exchangeCodexCallback({
      callbackUrl: `${CODEX_AUTH_REDIRECT_URI}?code=auth-code&state=${session.state}`,
      session,
      now: new Date('2026-06-18T00:00:00.000Z'),
      fetchImpl: fakeFetch as typeof fetch
    });

    assert.equal(credential.account_id, 'workspace-account-id');
    assert.equal(credential.email, 'child@example.com');
    assert.equal(credential.auth_mode, 'chatgpt');
    assert.equal(credential.credential_source, 'oauth');
    assert.equal(credential.expired, '2026-06-18T01:00:00.000Z');

    const body = new URLSearchParams(requests[0]!.body);
    assert.equal(requests[0]!.url, 'https://auth.openai.com/oauth/token');
    assert.equal(body.get('grant_type'), 'authorization_code');
    assert.equal(body.get('client_id'), CODEX_AUTH_CLIENT_ID);
    assert.equal(body.get('code_verifier'), session.codeVerifier);
  });

  it('routes the production token exchange through the named OpenAI transport', async () => {
    const session = createCodexAuthSession({ now: 1781748000000 });
    const idToken = unsignedJwt({
      email: 'child@example.com',
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'workspace-account-id',
        chatgpt_plan_type: 'team'
      }
    });
    const requests: HttpRequest[] = [];
    const transport: Transport = {
      async fetch(request) {
        requests.push(request);
        return {
          status: 200,
          body: JSON.stringify({
            access_token: 'access-token',
            refresh_token: 'refresh-token',
            id_token: idToken,
            expires_in: 3600
          })
        };
      }
    };

    await exchangeCodexCallback({
      callbackUrl: `${CODEX_AUTH_REDIRECT_URI}?code=auth-code&state=${session.state}`,
      session,
      transport,
      proxy: 'http://account-proxy.example:8080'
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0]!.baseUrl, 'https://auth.openai.com');
    assert.equal(requests[0]!.path, '/oauth/token');
    assert.equal(requests[0]!.upstream, 'codex-oauth-token-exchange');
    assert.equal(requests[0]!.proxy, 'http://account-proxy.example:8080');
    assert.equal(
      new URLSearchParams(requests[0]!.body).get('grant_type'),
      'authorization_code'
    );
  });

  it('rejects callbacks with a mismatched state', async () => {
    const session = createCodexAuthSession();
    await assert.rejects(
      () => exchangeCodexCallback({
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
