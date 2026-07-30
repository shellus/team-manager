import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { ApiResult, RrwebRecordingUploadView } from '@team-manager/shared';
import { AccountStore } from './accountStore.js';
import { buildApp } from './app.js';
import { SubaccountStore } from './subaccountStore.js';

const apiToken = 'rrweb-test-token';

function recording() {
  return {
    format: 'team-manager-rrweb',
    version: 1,
    createdAt: '2026-07-30T03:00:00.000Z',
    endedAt: '2026-07-30T03:00:05.000Z',
    page: {
      url: 'https://example.test/subaccounts',
      title: 'Team Manager',
      viewport: { width: 1440, height: 900, devicePixelRatio: 1 }
    },
    events: [
      { type: 4, data: {}, timestamp: 1 },
      { type: 2, data: {}, timestamp: 2 }
    ]
  };
}

describe('rrweb recording API', () => {
  it('uploads and reads a recording by its generated UUID', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'team-manager-rrweb-api-'));
    try {
      const store = new AccountStore(dataDir);
      await store.init();
      const subaccountStore = new SubaccountStore(dataDir);
      await subaccountStore.init();
      const app = await buildApp({
        config: {
          port: 3000,
          dataDir,
          jwtSecret: 'test-secret',
          jwtIssuer: 'team-manager',
          adminUsername: 'admin',
          apiToken,
          allowedOrigins: [],
          webDistDir: join(dataDir, 'dist')
        },
        store,
        subaccountStore
      });
      const headers = {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      };

      const upload = await app.request('/api/devtools/rrweb-recordings', {
        method: 'POST',
        headers,
        body: JSON.stringify(recording())
      });
      const uploadBody = (await upload.json()) as ApiResult<RrwebRecordingUploadView>;

      assert.equal(upload.status, 200);
      assert.equal(uploadBody.data!.eventCount, 2);

      const read = await app.request(`/api/devtools/rrweb-recordings/${uploadBody.data!.uuid}`, {
        headers
      });
      const readBody = (await read.json()) as ApiResult<ReturnType<typeof recording>>;

      assert.equal(read.status, 200);
      assert.deepEqual(readBody.data, recording());
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
