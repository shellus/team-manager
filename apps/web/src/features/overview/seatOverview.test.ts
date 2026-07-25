import { describe, expect, test } from 'vitest';
import type { AccountView } from '@team-manager/shared';
import {
  buildSeatOverviewItems,
  filterSeatOverviewItems,
  seatOverviewBadgeTarget,
  seatOverviewCardIdentity
} from './seatOverview.js';

function account(input: Partial<AccountView> & Pick<AccountView, 'id'>): AccountView {
  const { id, ...rest } = input;
  return {
    id,
    groupName: '默认分组',
    limitType: 'unknown',
    accountId: `workspace-${id}`,
    email: `${id}@example.com`,
    hasTeamSubscription: true,
    canManageWorkspace: true,
    ...rest
  };
}

describe('buildSeatOverviewItems', () => {
  test('creates two empty ChatGPT positions when a parent has no tracked members or slots', () => {
    const items = buildSeatOverviewItems([
      account({ id: 'team-a', workspaceName: 'Team A', nextRenewalOn: '2026-08-01' })
    ]);

    expect(items).toHaveLength(2);
    expect(items.map((item) => item.source)).toEqual(['placeholder', 'placeholder']);
    expect(items.every((item) => item.teamName === 'Team A')).toBe(true);
    expect(items.every((item) => item.seat === 'default')).toBe(true);
    expect(items.every((item) => item.status === 'empty')).toBe(true);
    expect(items.every((item) => item.expiresOn === '2026-08-01')).toBe(true);
  });

  test('does not create empty ChatGPT positions for a usage-based Workspace', () => {
    const items = buildSeatOverviewItems([
      account({
        id: 'codex-only',
        planType: 'self_serve_business_usage_based',
        hasTeamSubscription: false,
        membersCache: [{
          userId: 'owner-user',
          email: 'owner@example.com',
          role: 'account-owner',
          seat: 'usage_based'
        }]
      })
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(expect.objectContaining({
      source: 'member',
      seat: 'usage_based',
      email: 'owner@example.com'
    }));
    expect(items.some((item) => item.source === 'placeholder')).toBe(false);
  });

  test('keeps a Codex admin position separate from two ChatGPT seat slots', () => {
    const items = buildSeatOverviewItems([
      account({
        id: 'team-b',
        workspaceName: 'Team B',
        membersCache: [
          {
            userId: 'admin-user',
            email: 'admin@example.com',
            role: 'account-admin',
            seat: 'usage_based'
          }
        ],
        seatSlots: [
          {
            seatKey: 'slot-a',
            email: 'one@example.com',
            remark: '一号位',
            expiresOn: '2026-07-25',
            seat: 'default',
            status: 'member',
            expireRemove: false,
            expireReminder: true,
            updatedAt: 1
          },
          {
            seatKey: 'slot-b',
            email: 'two@example.com',
            remark: '二号位',
            expiresOn: '2026-07-26',
            seat: 'default',
            status: 'member',
            expireRemove: false,
            expireReminder: true,
            updatedAt: 1
          }
        ]
      })
    ]);

    expect(items).toHaveLength(3);
    expect(items.filter((item) => item.seat === 'default')).toHaveLength(2);
    expect(items.filter((item) => item.seat === 'usage_based')).toEqual([
      expect.objectContaining({
        source: 'member',
        role: 'account-admin',
        email: 'admin@example.com',
        status: 'member'
      })
    ]);
  });

  test('prefers the member relation when the same slotted email is also in pending invites', () => {
    const items = buildSeatOverviewItems([
      account({
        id: 'team-c',
        workspaceName: 'Team C',
        membersCache: [
          {
            userId: 'member-user',
            email: 'same@example.com',
            role: 'account-admin',
            seat: 'default'
          }
        ],
        pendingInvitesCache: [
          {
            inviteId: 'invite-user',
            email: 'same@example.com',
            role: 'standard-user',
            status: 1,
            seat: 'default',
            createdTime: '2026-06-18T00:00:00Z',
            isScimManaged: false
          }
        ],
        seatSlots: [
          {
            seatKey: 'slot-c',
            email: 'same@example.com',
            expiresOn: '2026-07-25',
            seat: 'default',
            expireRemove: false,
            expireReminder: true,
            updatedAt: 1
          }
        ]
      })
    ]);

    expect(items.find((item) => item.seatKey === 'slot-c')).toEqual(
      expect.objectContaining({
        role: 'account-admin',
        status: 'member'
      })
    );
  });

  test('sorts positions by expiry date and leaves undated positions last', () => {
    const items = buildSeatOverviewItems([
      account({
        id: 'late',
        workspaceName: 'Late Team',
        seatSlots: [
          {
            seatKey: 'late-slot',
            email: 'late@example.com',
            expiresOn: '2026-08-01',
            seat: 'default',
            status: 'member',
            expireRemove: false,
            expireReminder: true,
            updatedAt: 1
          }
        ]
      }),
      account({
        id: 'early',
        workspaceName: 'Early Team',
        seatSlots: [
          {
            seatKey: 'early-slot',
            email: 'early@example.com',
            expiresOn: '2026-07-01',
            seat: 'default',
            status: 'member',
            expireRemove: false,
            expireReminder: true,
            updatedAt: 1
          }
        ]
      })
    ]);

    expect(items[0]).toEqual(expect.objectContaining({ seatKey: 'early-slot' }));
    expect(items[1]).toEqual(expect.objectContaining({ seatKey: 'late-slot' }));
    expect(items.at(-1)?.expiresOn).toBeUndefined();
  });

  test('excludes empty positions from banned parents and sorts their occupied positions last', () => {
    const items = buildSeatOverviewItems([
      account({
        id: 'banned',
        isBanned: true,
        workspaceName: 'Banned Team',
        seatSlots: [
          {
            seatKey: 'banned-member',
            email: 'banned-member@example.com',
            expiresOn: '2026-07-01',
            seat: 'default',
            status: 'member',
            expireRemove: false,
            expireReminder: true,
            updatedAt: 1
          },
          {
            seatKey: 'banned-empty',
            expiresOn: '2026-07-02',
            seat: 'default',
            status: 'empty',
            expireRemove: false,
            expireReminder: true,
            updatedAt: 1
          }
        ]
      }),
      account({
        id: 'normal',
        workspaceName: 'Normal Team',
        seatSlots: [
          {
            seatKey: 'normal-member',
            email: 'normal-member@example.com',
            expiresOn: '2026-08-01',
            seat: 'default',
            status: 'member',
            expireRemove: false,
            expireReminder: true,
            updatedAt: 1
          },
          {
            seatKey: 'normal-empty',
            expiresOn: '2026-08-02',
            seat: 'default',
            status: 'empty',
            expireRemove: false,
            expireReminder: true,
            updatedAt: 1
          }
        ]
      })
    ]);

    expect(items.map((item) => item.seatKey)).toEqual([
      'normal-member',
      'normal-empty',
      'banned-member'
    ]);
    expect(items.at(-1)).toEqual(expect.objectContaining({ parentIsBanned: true }));
    expect(items.some((item) => item.seatKey === 'banned-empty')).toBe(false);
  });
});

describe('filterSeatOverviewItems', () => {
  const items = [
    {
      id: 'owner-default',
      accountRecordId: 'team-filter',
      workspaceAccountId: 'workspace-filter',
      teamName: 'Team Filter',
      parentEmail: 'owner@example.com',
      source: 'member',
      status: 'member',
      seat: 'default',
      role: 'account-owner',
      email: 'owner@example.com'
    },
    {
      id: 'member-default',
      accountRecordId: 'team-filter',
      workspaceAccountId: 'workspace-filter',
      teamName: 'Team Filter',
      parentEmail: 'owner@example.com',
      source: 'seat-slot',
      status: 'member',
      seat: 'default',
      role: 'standard-user',
      email: 'member@example.com'
    },
    {
      id: 'member-codex',
      accountRecordId: 'team-filter',
      workspaceAccountId: 'workspace-filter',
      teamName: 'Team Filter',
      parentEmail: 'owner@example.com',
      source: 'member',
      status: 'member',
      seat: 'usage_based',
      role: 'standard-user',
      email: 'codex@example.com'
    },
    {
      id: 'empty-default',
      accountRecordId: 'team-filter',
      workspaceAccountId: 'workspace-filter',
      teamName: 'Team Filter',
      parentEmail: 'owner@example.com',
      source: 'placeholder',
      status: 'empty',
      seat: 'default'
    }
  ] as const;

  test('hides owners and Codex seats by default', () => {
    expect(filterSeatOverviewItems(items).map((item) => item.id)).toEqual(['member-default', 'empty-default']);
  });

  test('can show owners without showing Codex seats', () => {
    expect(filterSeatOverviewItems(items, { showOwners: true }).map((item) => item.id)).toEqual([
      'owner-default',
      'member-default',
      'empty-default'
    ]);
  });

  test('can show Codex seats while still hiding owners', () => {
    expect(filterSeatOverviewItems(items, { showCodexSeats: true }).map((item) => item.id)).toEqual([
      'member-default',
      'member-codex',
      'empty-default'
    ]);
  });
});

describe('seat overview card display helpers', () => {
  test('uses the member seat as the badge target and non-member status as the badge target', () => {
    expect(
      seatOverviewBadgeTarget({
        id: 'member-default',
        accountRecordId: 'team-card',
        workspaceAccountId: 'workspace-card',
        teamName: 'Team Card',
        parentEmail: 'owner@example.com',
        source: 'seat-slot',
        status: 'member',
        seat: 'default'
      })
    ).toEqual({ kind: 'seat', seat: 'default' });

    expect(
      seatOverviewBadgeTarget({
        id: 'invited-default',
        accountRecordId: 'team-card',
        workspaceAccountId: 'workspace-card',
        teamName: 'Team Card',
        parentEmail: 'owner@example.com',
        source: 'invite',
        status: 'invited',
        seat: 'default'
      })
    ).toEqual({ kind: 'status', status: 'invited' });
  });

  test('uses email as the primary card identity and Team name as the secondary identity', () => {
    expect(
      seatOverviewCardIdentity({
        id: 'member-default',
        accountRecordId: 'team-card',
        workspaceAccountId: 'workspace-card',
        teamName: 'Team Card',
        parentEmail: 'owner@example.com',
        source: 'seat-slot',
        status: 'member',
        seat: 'default',
        email: 'member@example.com'
      })
    ).toEqual({ primary: 'member@example.com', secondary: 'Team Card' });

    expect(
      seatOverviewCardIdentity({
        id: 'empty-default',
        accountRecordId: 'team-card',
        workspaceAccountId: 'workspace-card',
        teamName: 'Team Card',
        parentEmail: 'owner@example.com',
        source: 'placeholder',
        status: 'empty',
        seat: 'default'
      })
    ).toEqual({ primary: '空位', secondary: 'Team Card' });
  });
});
