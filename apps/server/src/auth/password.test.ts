import assert from 'node:assert/strict';
import test from 'node:test';
import { BCRYPT_COST, assertPasswordFitsBcrypt, hashPassword, isSupportedBcryptHash, verifyPasswordHash } from './password.js';

test('bcrypt hashes and verifies administrator passwords at the configured cost', async () => {
  const stored = await hashPassword('正确的-password');
  assert.match(stored, new RegExp(`^\\$2[ab]\\$${BCRYPT_COST}\\$`));
  assert.equal(await verifyPasswordHash('正确的-password', stored), true);
  assert.equal(await verifyPasswordHash('wrong', stored), false);
});

test('accepts supported bcrypt prefixes and rejects misleading $2 prefixes', async () => {
  const stored = await hashPassword('prefix-test');
  const y = `$2y$${stored.slice(4)}`;
  assert.equal(isSupportedBcryptHash(y), true);
  assert.equal(await verifyPasswordHash('prefix-test', y), true);
  assert.equal(isSupportedBcryptHash(stored.replace(/^\$2[ab]\$/, '$2x$')), false);
});

test('enforces bcrypt 72-byte UTF-8 boundary', () => {
  assert.doesNotThrow(() => assertPasswordFitsBcrypt('a'.repeat(72)));
  assert.throws(() => assertPasswordFitsBcrypt('a'.repeat(73)), /72 UTF-8 字节/);
  assert.doesNotThrow(() => assertPasswordFitsBcrypt('界'.repeat(24)));
  assert.throws(() => assertPasswordFitsBcrypt(`${'界'.repeat(24)}a`), /72 UTF-8 字节/);
});
