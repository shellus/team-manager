import assert from 'node:assert/strict';
import test from 'node:test';
import type { ResidentialProxyConfig } from '@team-manager/shared';
import { normalizedProxy, validateProxy } from './services/accountManagerService.js';

const proxy = (sid: string): ResidentialProxyConfig => ({
  sid,
  country: 'us',
  asn: null,
  state: null,
  city: null,
});

test('住宅代理 SID 必须是 8 位字母或数字', () => {
  assert.doesNotThrow(() => validateProxy(proxy('ab12cd34')));
  assert.throws(() => validateProxy(proxy('abc1234')), /代理 SID 必须是 8 位字母或数字/);
  assert.throws(() => validateProxy(proxy('abc123456')), /代理 SID 必须是 8 位字母或数字/);
  assert.throws(() => validateProxy(proxy('abcd-123')), /代理 SID 必须是 8 位字母或数字/);
});

test('住宅代理配置提交前统一清理 SID 与国家代码', () => {
  assert.deepEqual(normalizedProxy(proxy(' ab12cd34 ')), {
    ...proxy('ab12cd34'),
    country: 'US',
  });
});
