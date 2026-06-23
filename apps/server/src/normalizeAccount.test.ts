import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAccountInput } from './normalizeAccount.js';

const validSession = {
  user: {
    email: 'owner@example.com'
  },
  account: {
    id: 'workspace-account-id'
  },
  accessToken: 'access-token'
};

describe('normalizeAccountInput', () => {
  it('normalizes the single supported ChatGPT session shape', () => {
    const account = normalizeAccountInput(validSession);

    assert.ok(!('error' in account));
    assert.equal(account.email, 'owner@example.com');
    assert.equal(account.note, undefined);
    assert.equal(account.groupName, '默认分组');
    assert.equal(account.limitType, 'unknown');
    assert.equal(account.accountId, 'workspace-account-id');
    assert.equal(account.accessToken, 'access-token');
  });

  it('rejects flat fields outside the ChatGPT session JSON shape', () => {
    const account = normalizeAccountInput({
      accountId: 'workspace-account-id',
      email: 'owner@example.com',
      accessToken: 'access-token'
    });

    assert.deepEqual(account, { error: '缺少 user.email' });
  });

  it('ignores flat email fields outside the session shape', () => {
    const account = normalizeAccountInput({
      ...validSession,
      email: 'flat@example.com'
    });

    assert.ok(!('error' in account));
    assert.equal(account.email, 'owner@example.com');
    assert.equal(account.groupName, '默认分组');
    assert.equal(account.limitType, 'unknown');
  });
});
