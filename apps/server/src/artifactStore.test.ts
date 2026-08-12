import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ArtifactStore } from './artifactStore.js';

test('ArtifactStore 原子保存并校验不可变制品', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'team-manager-artifact-'));
  try {
    const store = new ArtifactStore(directory);
    const saved = await store.writeImmutable('credentials', '../../credential.json', Buffer.from('{"ok":true}'));
    assert.match(saved.storageKey, /^credentials\/[0-9a-f]{2}\/[0-9a-f]{64}-credential\.json$/);
    assert.equal((await stat(store.resolveStorageKey(saved.storageKey))).mode & 0o777, 0o600);
    assert.equal((await store.read(saved.storageKey, saved.contentSha256)).toString(), '{"ok":true}');
    await store.verify(saved.storageKey, saved.contentSha256, saved.byteSize);
    assert.throws(() => store.resolveStorageKey('../outside'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
