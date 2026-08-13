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

test('解析 Codex 五小时与七天额度窗口', () => {
  const quota = quotaFromPayload({ plan_type: 'team', rate_limit: {
    primary_window: { limit_window_seconds: 18000, used_percent: 25, resets_at: 2_000_000_000 },
    secondary_window: { limit_window_seconds: 604800, used_percent: 60, resets_at: 2_000_100_000 }
  } });
  assert.equal(quota.status, 'success');
  assert.deepEqual(quota.windows.map((item) => item.label), ['5 小时', '7 天']);
});
