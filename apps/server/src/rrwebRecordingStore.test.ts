import assert from 'node:assert/strict';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { RrwebRecordingStore, RrwebRecordingStoreError } from './rrwebRecordingStore.js';

const gunzipAsync = promisify(gunzip);

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

describe('RrwebRecordingStore', () => {
  it('stores a private gzip package under a generated UUID and reads it back', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'team-manager-rrweb-'));
    try {
      const store = new RrwebRecordingStore(dir);
      await store.init();
      const saved = await store.save(recording());
      const path = join(dir, 'rrweb-recordings', `${saved.uuid}.json.gz`);
      const metadata = await stat(path);
      const persisted = JSON.parse((await gunzipAsync(await readFile(path))).toString('utf8'));

      assert.match(saved.uuid, /^[0-9a-f-]{36}$/);
      assert.equal(saved.eventCount, 2);
      assert.equal(metadata.mode & 0o777, 0o600);
      assert.deepEqual(persisted, recording());
      assert.deepEqual(await store.read(saved.uuid), recording());
      assert.equal(await store.read('not-a-uuid'), null);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects malformed recordings', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'team-manager-rrweb-'));
    try {
      const store = new RrwebRecordingStore(dir);
      await store.init();
      await assert.rejects(
        () => store.save({ format: 'team-manager-rrweb', version: 1, events: [] }),
        (error: unknown) => error instanceof RrwebRecordingStoreError && error.status === 400
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
