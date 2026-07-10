import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApiResult } from '@team-manager/shared';
import { AccountStore } from './accountStore.js';
import { buildApp } from './app.js';
import { verifyJwt } from './auth/jwt.js';
import { SubaccountStore } from './subaccountStore.js';

const secret = 'test-secret';
const issuer = 'team-manager';

function signTestToken(payload: Record<string, unknown>) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function decodePayload(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')) as Record<string, unknown>;
}

describe('JWT expiration compatibility', () => {
  it('accepts a valid access token without exp', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signTestToken({ sub: 'admin', iss: issuer, typ: 'access', iat: now });

    assert.deepEqual(verifyJwt({ token, issuer, tokenType: 'access', secret }), {
      sub: 'admin',
      iss: issuer,
      typ: 'access',
      iat: now
    });
  });

  it('continues accepting an unexpired legacy token with exp', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signTestToken({ sub: 'admin', iss: issuer, typ: 'access', iat: now, exp: now + 3600 });

    assert.notEqual(verifyJwt({ token, issuer, tokenType: 'access', secret }), null);
  });

  it('continues rejecting an expired legacy token with exp', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signTestToken({ sub: 'admin', iss: issuer, typ: 'access', iat: now - 3600, exp: now - 1 });

    assert.equal(verifyJwt({ token, issuer, tokenType: 'access', secret }), null);
  });
});

describe('admin login', () => {
  it('issues a non-expiring token that authorizes protected APIs', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'team-manager-auth-'));

    try {
      const store = new AccountStore(dataDir);
      await store.init();
      const subaccountStore = new SubaccountStore(dataDir);
      await subaccountStore.init();
      const app = await buildApp({
        config: {
          port: 3000,
          dataDir,
          jwtSecret: secret,
          jwtIssuer: issuer,
          adminUsername: 'admin',
          adminPassword: 'password',
          allowedOrigins: [],
          webDistDir: join(dataDir, 'dist')
        },
        store,
        subaccountStore
      });

      const login = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'password' })
      });
      const loginJson = (await login.json()) as ApiResult<{ token: string }>;

      assert.equal(login.status, 200);
      assert.equal(loginJson.ok, true);
      assert.equal('exp' in decodePayload(loginJson.data!.token), false);

      const protectedResponse = await app.request('/api/accounts', {
        headers: { Authorization: `Bearer ${loginJson.data!.token}` }
      });
      assert.equal(protectedResponse.status, 200);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
