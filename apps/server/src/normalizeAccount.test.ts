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
    assert.equal(account.label, 'owner@example.com');
    assert.equal(account.email, 'owner@example.com');
    assert.equal(account.accountId, 'workspace-account-id');
    assert.equal(account.accessToken, 'access-token');
  });

  it('does not accept the old flat compatibility shape', () => {
    const account = normalizeAccountInput({
      accountId: 'workspace-account-id',
      email: 'owner@example.com',
      accessToken: 'access-token'
    });

    assert.deepEqual(account, { error: '缺少 user.email' });
  });

  it('uses only user.email for label and email', () => {
    const account = normalizeAccountInput({
      ...validSession,
      label: 'custom label',
      email: 'flat@example.com'
    });

    assert.ok(!('error' in account));
    assert.equal(account.label, 'owner@example.com');
    assert.equal(account.email, 'owner@example.com');
  });
});
