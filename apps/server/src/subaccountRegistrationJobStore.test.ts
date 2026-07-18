import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SubaccountRegistrationJobStore } from './subaccountRegistrationJobStore.js';

describe('SubaccountRegistrationJobStore', () => {
  it('persists progress so a new store instance restores the task', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'teammgr-registration-jobs-'));
    try {
      const store = new SubaccountRegistrationJobStore(dir);
      await store.init();
      const created = await store.create();
      await store.update(created.id, {
        status: 'failed',
        phase: 'registration_failed',
        message: 'mailbox unavailable',
        progress: 100,
        email: 'child@example.com',
        completedAt: Date.now(),
        error: 'mailbox unavailable'
      });

      const restored = new SubaccountRegistrationJobStore(dir);
      await restored.init();
      assert.deepEqual(restored.get(created.id), store.get(created.id));
      const persisted = JSON.parse(await readFile(join(dir, 'subaccount-registration-jobs.json'), 'utf8'));
      assert.equal(persisted[0].email, 'child@example.com');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('marks active tasks interrupted after a service restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'teammgr-registration-jobs-'));
    try {
      const store = new SubaccountRegistrationJobStore(dir);
      await store.init();
      const created = await store.create();
      await store.update(created.id, {
        status: 'running',
        phase: 'gongxi_mail_poll',
        message: '正在读取验证码',
        progress: 60
      });

      const restored = new SubaccountRegistrationJobStore(dir);
      await restored.init();
      const interrupted = restored.get(created.id)!;
      assert.equal(interrupted.status, 'interrupted');
      assert.equal(interrupted.phase, 'registration_interrupted');
      assert.equal(interrupted.progress, 60);
      assert.match(interrupted.message, /服务重启/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('removes every persisted task linked to a deleted subaccount', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'teammgr-registration-jobs-'));
    try {
      const store = new SubaccountRegistrationJobStore(dir);
      await store.init();
      const first = await store.create();
      const second = await store.create();
      await store.update(first.id, {
        status: 'failed',
        phase: 'registration_failed',
        message: 'failed',
        progress: 100,
        subaccountId: 'deleted-subaccount-id'
      });
      await store.update(second.id, {
        status: 'succeeded',
        phase: 'registration_complete',
        message: 'complete',
        progress: 100,
        subaccountId: 'deleted-subaccount-id'
      });

      assert.equal(await store.removeBySubaccountId('deleted-subaccount-id'), 2);
      assert.equal(store.get(first.id), undefined);
      assert.equal(store.get(second.id), undefined);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
