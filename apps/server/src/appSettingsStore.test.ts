import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { AppSettingsStore } from './appSettingsStore.js';

describe('AppSettingsStore task form preferences', () => {
  it('loads defaults from a legacy notification-only settings file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'team-manager-settings-'));
    try {
      await writeFile(join(dir, 'app-settings.json'), JSON.stringify({
        advanceReminderDays: 5,
        triggerTime: '09:30',
        channels: {}
      }));
      const store = new AppSettingsStore(dir);
      await store.init();

      assert.deepEqual(store.getTaskFormPreferences(), {
        parentRegistration: { country: 'US', groupName: '默认分组' },
        subaccountRegistration: { country: 'US', groupName: '默认分组' },
        pro5x: { usePromoCode: true, promoCode: 'stb' }
      });
      assert.equal(store.getNotificationSettings().triggerTime, '09:30');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('merges partial updates and persists the latest submitted form values', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'team-manager-settings-'));
    try {
      const store = new AppSettingsStore(dir);
      await store.init();
      await store.updateTaskFormPreferences({
        parentRegistration: { country: 'sg', groupName: ' 母号池 ' }
      });
      await store.updateTaskFormPreferences({
        pro5x: { usePromoCode: false, promoCode: ' last-code ' }
      });

      const reloaded = new AppSettingsStore(dir);
      await reloaded.init();
      assert.deepEqual(reloaded.getTaskFormPreferences(), {
        parentRegistration: { country: 'SG', groupName: '母号池' },
        subaccountRegistration: { country: 'US', groupName: '默认分组' },
        pro5x: { usePromoCode: false, promoCode: 'last-code' }
      });
      const persisted = JSON.parse(await readFile(join(dir, 'app-settings.json'), 'utf8'));
      assert.equal(persisted.taskFormPreferences.pro5x.promoCode, 'last-code');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
