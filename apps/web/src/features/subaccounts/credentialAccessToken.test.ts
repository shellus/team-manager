import { describe, expect, test } from 'vitest';
import type { CodexCredentialJson } from '@team-manager/shared';
import { credentialAccessToken } from './credentialAccessToken.js';

function credentialWithAccessToken(accessToken: string): CodexCredentialJson {
  return {
    access_token: accessToken,
    account_id: 'workspace-1',
    last_refresh: '2026-06-30T00:00:00.000Z',
    email: 'child@example.com',
    type: 'codex',
    expired: '2026-07-30T00:00:00.000Z'
  };
}

describe('credentialAccessToken', () => {
  test('returns the trimmed access_token from a Codex credential JSON', () => {
    expect(credentialAccessToken(credentialWithAccessToken('  ak-workspace-token  '))).toBe('ak-workspace-token');
  });

  test('throws when the Codex credential JSON has no access_token value', () => {
    expect(() => credentialAccessToken(credentialWithAccessToken('   '))).toThrow('Codex 凭证缺少 access_token');
  });
});
