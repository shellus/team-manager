import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { SecretCipher, sha256 } from './secretCipher.js';

test('SecretCipher 使用上下文绑定并可恢复明文', () => {
  const cipher = new SecretCipher(randomBytes(32).toString('base64'), 'v1');
  const encrypted = cipher.encrypt('private session', 'account:one');
  assert.equal(cipher.decrypt(encrypted, 'account:one'), 'private session');
  assert.throws(() => cipher.decrypt(encrypted, 'account:two'));
  assert.equal(encrypted.keyVersion, 'v1');
  assert.equal(sha256('private session').length, 64);
});

test('SecretCipher 拒绝错误长度的密钥', () => {
  assert.throws(() => new SecretCipher('too-short', 'v1'), /32 字节/);
});
