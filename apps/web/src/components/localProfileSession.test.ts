import { describe, expect, test } from 'vitest';
import { formatLocalProfileSessionJson, shouldSubmitLocalProfileSession } from './localProfileSession.js';

describe('local profile session helpers', () => {
  test('formats the existing session JSON for editing without redaction', () => {
    expect(
      formatLocalProfileSessionJson({
        user: { email: 'child@example.com' },
        account: { id: 'workspace-account-id' },
        accessToken: 'child-web-access-token',
        sessionToken: 'child-session-json-token'
      })
    ).toBe(
      [
        '{',
        '  "user": {',
        '    "email": "child@example.com"',
        '  },',
        '  "account": {',
        '    "id": "workspace-account-id"',
        '  },',
        '  "accessToken": "child-web-access-token",',
        '  "sessionToken": "child-session-json-token"',
        '}'
      ].join('\n')
    );
  });

  test('submits session only when the editor value changes', () => {
    const initial = formatLocalProfileSessionJson({
      user: { email: 'child@example.com' },
      account: { id: 'workspace-account-id' },
      accessToken: 'child-web-access-token'
    });

    expect(shouldSubmitLocalProfileSession(`${initial}\n`, initial)).toBe(false);
    expect(shouldSubmitLocalProfileSession('', initial)).toBe(false);
    expect(shouldSubmitLocalProfileSession('{"user":{"email":"new@example.com"}}', initial)).toBe(true);
  });
});
