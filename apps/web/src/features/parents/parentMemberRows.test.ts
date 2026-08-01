import { describe, expect, test } from 'vitest';
import type { AccountView } from '@team-manager/shared';
import { buildParentMemberRows } from './parentMemberRows.js';

describe('buildParentMemberRows', () => {
  test('merges member, invite and customer slot records by normalized email', () => {
    const account: AccountView = {
      id: 'parent-1',
      groupName: '默认分组',
      limitType: 'unknown',
      accountId: 'workspace-1',
      email: 'owner@example.com',
      status: 'active',
      hasTeamSubscription: true,
      canManageWorkspace: true,
      membersCache: [{
        userId: 'member-1',
        email: 'Member@Example.com',
        role: 'standard-user',
        seat: 'default'
      }],
      pendingInvitesCache: [{
        inviteId: 'invite-1',
        email: 'pending@example.com',
        role: 'standard-user',
        status: 1,
        seat: 'usage_based',
        createdTime: '2026-08-01T00:00:00Z',
        isScimManaged: false
      }],
      seatSlots: [
        {
          seatKey: 'memb1234efgh5678',
          email: 'member@example.com',
          expiresOn: '2026-09-01',
          seat: 'default',
          status: 'member',
          expireRemove: false,
          expireReminder: true,
          updatedAt: 1
        },
        {
          seatKey: 'pend1234efgh5678',
          email: 'pending@example.com',
          expiresOn: '2026-09-02',
          seat: 'usage_based',
          status: 'invited',
          expireRemove: false,
          expireReminder: true,
          updatedAt: 1
        },
        {
          seatKey: 'lost1234efgh5678',
          email: 'lost@example.com',
          expiresOn: '2026-09-03',
          seat: 'default',
          status: 'unknown',
          expireRemove: false,
          expireReminder: true,
          updatedAt: 1
        }
      ]
    };

    const rows = buildParentMemberRows(account);

    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.email === 'member@example.com')).toMatchObject({
      relationStatus: 'member',
      member: { userId: 'member-1' },
      slot: { seatKey: 'memb1234efgh5678' }
    });
    expect(rows.find((row) => row.email === 'pending@example.com')).toMatchObject({
      relationStatus: 'invited',
      invite: { inviteId: 'invite-1' },
      slot: { seatKey: 'pend1234efgh5678' }
    });
    expect(rows.find((row) => row.email === 'lost@example.com')).toMatchObject({
      relationStatus: 'unknown',
      slot: { seatKey: 'lost1234efgh5678' }
    });
  });
});
