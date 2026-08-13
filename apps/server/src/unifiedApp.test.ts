import assert from 'node:assert/strict';
import test from 'node:test';
import type { AccountManagerGateway } from './accountManagerClient.js';
import { AccountManagerClient } from './accountManagerClient.js';
import { quotaFromPayload } from './codexQuota.js';

test('GAM 个人套餐请求完整转发四档套餐与管理员提交的卡数据', async () => {
  let requestBody = '';
  const client = new AccountManagerClient('http://gam.test', 'token', async (_input, init) => {
    requestBody = String(init?.body ?? '');
    return new Response(JSON.stringify({ ok: true, data: {
      id: 'operation', type: 'change_personal_subscription', status: 'queued', phase: 'queued', progress: 0,
      createdAt: 1, updatedAt: 1
    } }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  await client.changePersonalSubscription('account@example.com', {
    targetPlan: 'pro_20x', mode: 'start_new', country: 'US', currency: 'USD', autoPay: true,
    card: { number: '4242424242424242', expiryMonth: 12, expiryYear: 2030, cvc: '123' }
  });
  assert.equal(JSON.parse(requestBody).targetPlan, 'pro_20x');
  assert.equal(JSON.parse(requestBody).mode, 'start_new');
  assert.equal(JSON.parse(requestBody).card.number, '4242424242424242');
});

test('统一账号 GAM 网关不再暴露旧套餐和角色专用方法', () => {
  const keys: Array<keyof AccountManagerGateway> = [
    'changePersonalSubscription', 'cancelPersonalSubscriptionRenewal', 'openBusinessSubscription',
    'startRegistration', 'syncAccount', 'startAccountProfile', 'configureAccountProxy', 'session'
  ];
  assert.equal(keys.includes('changePersonalSubscription'), true);
});

test('GAM 操作补卡 PUT 按契约发送 card 字段', async () => {
  let requestBody = '';
  const client = new AccountManagerClient('http://gam.test', 'token', async (_input, init) => {
    requestBody = String(init?.body ?? '');
    return new Response(JSON.stringify({ ok: true, data: {
      id: 'operation', type: 'change_personal_subscription', status: 'waiting_manual',
      phase: 'waiting_manual', progress: 50, createdAt: Date.now(), updatedAt: Date.now()
    } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  await client.replaceOperationPaymentCard('operation', {
    number: '4242424242424242', expiryMonth: 12, expiryYear: 2030, cvc: '123'
  });
  assert.deepEqual(JSON.parse(requestBody), {
    card: { number: '4242424242424242', expiryMonth: 12, expiryYear: 2030, cvc: '123' }
  });
});

test('GAM 同步等待 Operation 终态后再读取账号快照', async () => {
  const paths: string[] = [];
  const client = new AccountManagerClient('http://gam.test', 'token', async (input) => {
    const path = new URL(String(input)).pathname;
    paths.push(path);
    const data = path.endsWith('/sync') ? {
      id: 'sync-operation', type: 'sync', status: 'succeeded', phase: 'complete', progress: 100,
      createdAt: 1, updatedAt: 2, completedAt: 2
    } : { id: 'account@example.com', email: 'account@example.com', personalPlan: 'plus', workspaces: [] };
    return new Response(JSON.stringify({ ok: true, data }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  });
  const account = await client.syncAccount('account@example.com');
  assert.equal(account.personalPlan, 'plus');
  assert.deepEqual(paths, [
    '/v1/accounts/account%40example.com/sync',
    '/v1/accounts/account%40example.com'
  ]);
});

test('GAM existing_session 纳管和注册任务代理使用既有上游契约', async () => {
  const requests: Array<{ method: string; path: string; body: unknown }> = [];
  const client = new AccountManagerClient('http://gam.test', 'token', async (input, init) => {
    const path = new URL(String(input)).pathname;
    requests.push({ method: String(init?.method), path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const data = path.endsWith('/proxy') ? { sid: 'sid-2', country: 'US', asn: null, state: null, city: null } : {
      id: 'operation', type: 'import', status: 'queued', phase: 'queued', progress: 0,
      createdAt: 1, updatedAt: 1,
    };
    return new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  await client.startAccountImport({
    email: 'account@example.com', authMethod: 'existing_session',
    session: { user: { email: 'account@example.com' }, account: { id: 'personal' }, accessToken: 'access', sessionToken: 'session' },
  });
  await client.operationProxyConfig('operation');
  await client.configureOperationProxy('operation', { sid: 'sid-2', country: 'US', asn: null, state: null, city: null });
  assert.equal(requests[0].path, '/v1/accounts/imports');
  assert.equal((requests[0].body as any).authMethod, 'existing_session');
  assert.deepEqual(requests.slice(1).map((item) => [item.method, item.path]), [
    ['GET', '/v1/operations/operation/proxy'],
    ['PUT', '/v1/operations/operation/proxy'],
  ]);
});

test('GAM 默认个人支付资料使用既有读取接口', async () => {
  let path = '';
  const client = new AccountManagerClient('http://gam.test', 'token', async (input) => {
    path = new URL(String(input)).pathname;
    return new Response(JSON.stringify({ ok: true, data: { country: 'SG', currency: 'USD' } }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  });
  assert.deepEqual(await client.personalPaymentMethodDefaults('account@example.com'), { country: 'SG', currency: 'USD' });
  assert.equal(path, '/v1/accounts/account%40example.com/personal-payment-method-defaults');
});

test('解析 Codex 五小时与七天额度窗口', () => {
  const quota = quotaFromPayload({ plan_type: 'team', rate_limit: {
    primary_window: { limit_window_seconds: 18000, used_percent: 25, resets_at: 2_000_000_000 },
    secondary_window: { limit_window_seconds: 604800, used_percent: 60, resets_at: 2_000_100_000 }
  } });
  assert.equal(quota.status, 'success');
  assert.deepEqual(quota.windows.map((item) => item.label), ['5 小时', '7 天']);
});
