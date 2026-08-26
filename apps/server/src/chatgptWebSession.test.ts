import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fetchWorkspaceExchangeSessionFromSessionToken,
  fetchWorkspaceWebSessionFromSessionToken
} from './chatgptWebSession.js';
import type { HttpRequest, HttpResponse, Transport } from './transport.js';

const targetWorkspaceId = '0a9b56ec-c0a2-473f-a8ea-8f25ef8cc5fc';
const personalAccountId = 'c44458f2-f161-47c1-92df-c58db0f682d6';

function token(accountId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    'https://api.openai.com/auth': { chatgpt_account_id: accountId }
  })).toString('base64url');
  return `${header}.${payload}.signature`;
}

function transportWithBody(body: Record<string, unknown>): Transport & { request?: HttpRequest } {
  return {
    async fetch(request) {
      this.request = request;
      return { status: 200, body: JSON.stringify(body) } satisfies HttpResponse;
    }
  };
}

test('上游带 RefreshAccessTokenError 时，不把个人 AT 误报为 Workspace 不一致', async () => {
  const transport = transportWithBody({
    error: 'RefreshAccessTokenError',
    accessToken: token(personalAccountId),
    account: { id: personalAccountId, structure: 'personal' }
  });

  await assert.rejects(
    fetchWorkspaceExchangeSessionFromSessionToken(transport, 'session-token', targetWorkspaceId),
    (error: unknown) => {
      assert.equal((error as { status: number }).status, 502);
      assert.match((error as Error).message, /Web session 刷新失败：RefreshAccessTokenError/);
      assert.doesNotMatch((error as Error).message, /与目标不一致/);
      return true;
    }
  );
});

test('旧 Web Session 路径同样优先报告上游刷新错误', async () => {
  const transport = transportWithBody({
    error: 'RefreshAccessTokenError',
    accessToken: token(personalAccountId)
  });

  await assert.rejects(
    fetchWorkspaceWebSessionFromSessionToken(transport, 'session-token', targetWorkspaceId),
    (error: unknown) => {
      assert.equal((error as { status: number }).status, 502);
      assert.match((error as Error).message, /Web session 刷新失败：RefreshAccessTokenError/);
      return true;
    }
  );
});

test('没有上游错误且 JWT 属于目标 Workspace 时才接受 AT', async () => {
  const accessToken = token(targetWorkspaceId);
  const transport = transportWithBody({ accessToken, user: { email: 'owner@example.com' } });
  const result = await fetchWorkspaceExchangeSessionFromSessionToken(transport, 'session-token', targetWorkspaceId);
  assert.equal(result.accountId, targetWorkspaceId);
  assert.equal(result.accessToken, accessToken);
});
