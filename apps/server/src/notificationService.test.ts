import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Account, NotificationSettings } from '@team-manager/shared';
import {
  collectExpirationReminderItems,
  formatExpirationReminderText,
  sendExpirationReminders,
  startNotificationScheduler
} from './notificationService.js';

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
  it('selects Team renewals and enabled customer seats within the global reminder window', () => {
    const accounts: Account[] = [
      {
        id: 'account-a',
        accountId: 'workspace-id',
        email: 'owner@example.com',
        remark: '主 Team',
        accessToken: 'token',
        workspaceName: 'Team A',
        nextRenewalOn: '2026-07-02',
        pendingInvitesCache: [
          {
            inviteId: 'invite-a',
            email: 'pending@example.com',
            role: 'standard-user',
            status: 1,
            seat: 'default',
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
        seatSlots: [
          {
            seatKey: 'pend1234efgh5678',
            email: 'pending@example.com',
            remark: '待接受',
            expiresOn: '2026-07-03',
            seat: 'default',
            expireRemove: false,
            expireReminder: true,
            updatedAt: 100
          },
          {
            seatKey: 'memb1234efgh5678',
            email: 'member@example.com',
            remark: '已入组',
            expiresOn: '2026-07-04',
            seat: 'default',
            expireRemove: true,
            expireReminder: true,
            updatedAt: 100
          },
          {
            seatKey: 'quie1234efgh5678',
            email: 'quiet@example.com',
            remark: '关闭提醒',
            expiresOn: '2026-07-02',
            seat: 'default',
            expireRemove: false,
            expireReminder: false,
            updatedAt: 100
          }
        ]
      }
    ];

    const items = collectExpirationReminderItems(
      accounts,
      notificationSettings,
      new Date('2026-06-30T00:00:00.000Z')
    );

    assert.deepEqual(
      items.map((item) => item.type === 'team_renewal'
        ? {
            type: item.type,
            accountId: item.accountId,
            workspaceName: item.workspaceName,
            ownerEmail: item.ownerEmail,
            expiresOn: item.expiresOn,
            daysUntilExpiry: item.daysUntilExpiry
          }
        : {
            type: item.type,
            accountId: item.accountId,
            workspaceName: item.workspaceName,
            email: item.email,
            status: item.status,
            expiresOn: item.expiresOn,
            daysUntilExpiry: item.daysUntilExpiry,
            expireRemove: item.expireRemove
          }),
      [
        {
          type: 'team_renewal',
          accountId: 'account-a',
          workspaceName: 'Team A',
          ownerEmail: 'owner@example.com',
          expiresOn: '2026-07-02',
          daysUntilExpiry: 2
        },
        {
          type: 'seat_expiration',
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

describe('expiration reminder text', () => {
  it('always renders both reminder sections when only Team renewals exist', () => {
    const text = formatExpirationReminderText(notificationSettings, [
      {
        type: 'team_renewal',
        accountId: 'account-a',
        workspaceName: 'Team A',
        ownerEmail: 'owner@example.com',
        remark: '母号备注',
        expiresOn: '2026-07-02',
        daysUntilExpiry: 2
      }
    ]);

    assert.equal(
      text,
      [
        'Team 到期提醒：未来 3 天内共 1 项',
        '',
        'Team 续费（1）',
        '- 备注：母号备注｜邮箱：owner@example.com｜到期：2026-07-02（剩余 2 天）',
        '',
        '客户席位到期（0）',
        '- 无'
      ].join('\n')
    );
  });

  it('uses the same remark, email and expiry layout for customer seats', () => {
    const text = formatExpirationReminderText(notificationSettings, [
      {
        type: 'seat_expiration',
        accountId: 'account-a',
        workspaceName: 'Team A',
        email: 'pending@example.com',
        remark: '客户备注',
        expiresOn: '2026-07-03',
        daysUntilExpiry: 3,
        expireRemove: true,
        status: 'invited'
      }
    ]);

    assert.equal(
      text,
      [
        'Team 到期提醒：未来 3 天内共 1 项',
        '',
        'Team 续费（0）',
        '- 无',
        '',
        '客户席位到期（1）',
        '- 备注：客户备注｜邮箱：pending@example.com｜到期：2026-07-03（剩余 3 天）'
      ].join('\n')
    );
  });

  it('does not send when both reminder sections are empty', async () => {
    assert.equal(
      formatExpirationReminderText(notificationSettings, []),
      [
        'Team 到期提醒：未来 3 天内共 0 项',
        '',
        'Team 续费（0）',
        '- 无',
        '',
        '客户席位到期（0）',
        '- 无'
      ].join('\n')
    );

    let fetchCalls = 0;
    const result = await sendExpirationReminders(notificationSettings, [], async () => {
      fetchCalls += 1;
      return new Response(null, { status: 200 });
    });

    assert.equal(fetchCalls, 0);
    assert.deepEqual(result, { itemCount: 0, sentChannels: [], errors: [] });
  });

  it('sends canonical reminder types and per-section counts to generic webhooks', async () => {
    let payload: Record<string, unknown> | undefined;
    const settings: NotificationSettings = {
      ...notificationSettings,
      channels: {
        ...notificationSettings.channels,
        webhook: { enabled: true, url: 'https://example.invalid/reminders' }
      }
    };
    const result = await sendExpirationReminders(
      settings,
      [
        {
          type: 'team_renewal',
          accountId: 'account-a',
          workspaceName: 'Team A',
          ownerEmail: 'owner@example.com',
          expiresOn: '2026-07-02',
          daysUntilExpiry: 2
        },
        {
          type: 'seat_expiration',
          accountId: 'account-a',
          workspaceName: 'Team A',
          email: 'member@example.com',
          expiresOn: '2026-07-03',
          daysUntilExpiry: 3,
          expireRemove: false,
          status: 'member'
        }
      ],
      async (_url, init) => {
        payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(null, { status: 200 });
      }
    );

    assert.deepEqual(result, { itemCount: 2, sentChannels: ['webhook'], errors: [] });
    assert.equal(payload?.type, 'expiration_reminder');
    assert.equal(payload?.itemCount, 2);
    assert.equal(payload?.teamRenewalCount, 1);
    assert.equal(payload?.seatExpirationCount, 1);
    assert.deepEqual(
      (payload?.items as Array<{ type: string }>).map((item) => item.type),
      ['team_renewal', 'seat_expiration']
    );
  });
});

describe('expiration reminder scheduler', () => {
  it('keeps the daily reminder runnable when every enabled channel fails', async () => {
    const originalFetch = globalThis.fetch;
    const today = localDateString(new Date());
    const accounts: Account[] = [
      {
        id: 'account-a',
        accountId: 'workspace-id',
        email: 'owner@example.com',
        remark: '主 Team',
        accessToken: 'token',
        workspaceName: 'Team A',
        nextRenewalOn: today
      }
    ];
    const settings: NotificationSettings = {
      ...notificationSettings,
      triggerTime: '00:00',
      lastRunDate: '2000-01-01',
      channels: {
        ...notificationSettings.channels,
        wecom: { enabled: true, webhookUrl: 'https://example.invalid/wecom' }
      }
    };
    const markedDates: string[] = [];
    let fetchCalls = 0;

    try {
      globalThis.fetch = (async () => {
        fetchCalls += 1;
        return new Response('failed', { status: 500 });
      }) as typeof fetch;

      const stop = startNotificationScheduler(
        {
          getNotificationSettings: () => settings,
          markNotificationRun: async (date: string) => {
            markedDates.push(date);
            return settings;
          }
        } as any,
        { list: () => accounts } as any,
        60_000
      );

      await waitFor(() => fetchCalls > 0);
      stop();

      assert.equal(fetchCalls, 1);
      assert.deepEqual(markedDates, []);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

function localDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('condition was not met');
}
