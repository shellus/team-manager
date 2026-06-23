import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Account, NotificationSettings } from '@team-manager/shared';
import { collectExpirationReminderItems } from './notificationService.js';

const notificationSettings: NotificationSettings = {
  advanceReminderDays: 3,
  triggerTime: '08:00',
  channels: {
    webhook: { enabled: false, url: '' },
    feishu: { enabled: false, webhookUrl: '' },
    telegram: { enabled: false, botToken: '', chatId: '' },
    wecom: { enabled: false, webhookUrl: '' }
  }
};

describe('expiration reminder collection', () => {
  it('selects enabled email profiles expiring within the global reminder window', () => {
    const accounts: Account[] = [
      {
        id: 'account-a',
        accountId: 'workspace-id',
        email: 'owner@example.com',
        accessToken: 'token',
        workspaceName: 'Team A',
        pendingInvitesCache: [
          {
            inviteId: 'invite-a',
            email: 'pending@example.com',
            role: 'standard-user',
            status: 1,
            seat: 'usage_based',
            createdTime: '2026-06-18T00:00:00Z',
            isScimManaged: false
          }
        ],
        membersCache: [
          {
            userId: 'user-a',
            email: 'member@example.com',
            role: 'standard-user',
            seat: 'default'
          }
        ],
        memberProfiles: {
          'pending@example.com': {
            email: 'pending@example.com',
            note: '待接受',
            expiresOn: '2026-07-03',
            expireRemove: false,
            expireReminder: true,
            updatedAt: 100
          },
          'member@example.com': {
            email: 'member@example.com',
            note: '已入组',
            expiresOn: '2026-07-04',
            expireRemove: true,
            expireReminder: true,
            updatedAt: 100
          },
          'quiet@example.com': {
            email: 'quiet@example.com',
            note: '关闭提醒',
            expiresOn: '2026-07-02',
            expireRemove: false,
            expireReminder: false,
            updatedAt: 100
          }
        }
      }
    ];

    const items = collectExpirationReminderItems(
      accounts,
      notificationSettings,
      new Date('2026-06-30T00:00:00.000Z')
    );

    assert.deepEqual(
      items.map((item) => ({
        accountId: item.accountId,
        workspaceName: item.workspaceName,
        email: item.email,
        status: item.status,
        expiresOn: item.expiresOn,
        daysUntilExpiry: item.daysUntilExpiry,
        expireRemove: item.expireRemove
      })),
      [
        {
          accountId: 'account-a',
          workspaceName: 'Team A',
          email: 'pending@example.com',
          status: 'invited',
          expiresOn: '2026-07-03',
          daysUntilExpiry: 3,
          expireRemove: false
        }
      ]
    );
  });
});
