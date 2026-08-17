import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePersonalPlan } from './domain/personalPlan.js';

test('个人当前套餐优先使用 accounts/check 的 personal 条目', () => {
  const result = resolvePersonalPlan([
    {
      accountId: 'workspace-account',
      planType: 'self_serve_business_usage_based',
      structure: 'workspace',
      canAccessWithSession: true
    },
    {
      accountId: 'personal-account',
      planType: 'free',
      structure: 'personal',
      canAccessWithSession: true
    }
  ], 'personal-account', 'plus');

  assert.deepEqual(result, {
    accountId: 'personal-account',
    rawPlanCode: 'free',
    normalizedPlan: 'free'
  });
});

test('accounts/check 未提供个人套餐时才回退到订阅记录', () => {
  const result = resolvePersonalPlan([
    {
      accountId: 'workspace-account',
      planType: 'plus',
      structure: 'workspace',
      canAccessWithSession: true
    }
  ], 'personal-account', 'plus');

  assert.deepEqual(result, {
    rawPlanCode: 'plus',
    normalizedPlan: 'plus'
  });
});

test('唯一 personal 条目可以纠正 Session 中过时的账号上下文', () => {
  const result = resolvePersonalPlan([
    {
      accountId: 'actual-personal-account',
      planType: 'go',
      structure: 'personal',
      canAccessWithSession: true
    }
  ], 'stale-account', 'plus');

  assert.equal(result.accountId, 'actual-personal-account');
  assert.equal(result.normalizedPlan, 'go');
});
