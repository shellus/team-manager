import { describe, expect, test } from 'vitest';
import type { CodexCredentialJson, SubaccountView } from '@team-manager/shared';
import { buildCredentialDownload, buildWorkspaceSessionDownload } from './credentialDownload.js';

const subaccount = {
  id: 'sub-1',
  email: 'child@example.com',
  remark: 'Child',
  hasWebSession: true,
  status: 'codex_ready',
  teamLinks: [],
  codexCredentials: [
    {
      accountId: 'workspace-1',
      fileName: 'child-workspace-1.json',
      groupName: 'CPA-A',
      hasCredential: true
    }
  ],
  createdAt: 1,
  updatedAt: 2
} satisfies SubaccountView;

describe('credentialDownload', () => {
  test('uses the stored credential file name and pretty JSON content', () => {
    const credential = {
      access_token: 'at-token',
      personal_access_token: 'at-token',
      account_id: 'workspace-1',
      last_refresh: '2026-06-25T00:00:00.000Z',
      email: 'child@example.com',
      type: 'codex',
      expired: '2026-07-25T00:00:00.000Z',
      auth_mode: 'personalAccessToken'
    } satisfies CodexCredentialJson;

    const download = buildCredentialDownload(subaccount, 'workspace-1', credential);

    expect(download.fileName).toBe('child-workspace-1.json');
    expect(download.content).toBe(`${JSON.stringify(credential, null, 2)}\n`);
    expect(download.mimeType).toBe('application/json;charset=utf-8');
  });

  test('falls back to a safe credential file name', () => {
    const download = buildCredentialDownload(subaccount, 'workspace-2', {
      access_token: 'at-token',
      personal_access_token: 'at-token',
      account_id: 'workspace-2',
      last_refresh: '2026-06-25T00:00:00.000Z',
      email: 'Second.Child+PAT@example.com',
      type: 'codex',
      expired: '2026-07-25T00:00:00.000Z'
    });

    expect(download.fileName).toBe('second.child-pat-example.com-workspace-2.json');
  });

  test('builds a workspace session download with the full ChatGPT session JSON', () => {
    const session = {
      user: { email: 'child@example.com' },
      account: { id: 'workspace-1' },
      accessToken: 'workspace-web-access-token',
      expires: '2026-07-08T12:00:00.000Z'
    };

    const download = buildWorkspaceSessionDownload(subaccount, 'workspace-1', session);

    expect(download.fileName).toBe('child-example.com-workspace-1-session.json');
    expect(download.content).toBe(`${JSON.stringify(session, null, 2)}\n`);
    expect(download.mimeType).toBe('application/json;charset=utf-8');
  });
});
