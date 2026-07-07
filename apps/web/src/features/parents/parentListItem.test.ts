import { describe, expect, test } from 'vitest';
import {
  parentChatGptSeatUsageCount,
  parentListIdentity,
  parentMemberAndInviteCount,
  parentSeatUsageClass
} from './parentListItem.js';

describe('parentListIdentity', () => {
  test('uses remark and email on one line when the parent has a remark', () => {
    expect(parentListIdentity({ remark: 'team3', email: 'owner@example.com' })).toBe('team3 · owner@example.com');
  });

  test('falls back to email without repeating it when remark is missing or already the email', () => {
    expect(parentListIdentity({ remark: '', email: 'owner@example.com' })).toBe('owner@example.com');
    expect(parentListIdentity({ remark: 'Owner@Example.com', email: 'owner@example.com' })).toBe('owner@example.com');
  });
});

describe('parentSeatUsageClass', () => {
  test('uses success only when ChatGPT seats exactly reach the included count', () => {
    expect(parentSeatUsageClass(2, 2)).toBe('text-success');
  });

  test('keeps over-capacity ChatGPT seats as a warning state', () => {
    expect(parentSeatUsageClass(3, 2)).toBe('text-warning');
    expect(parentSeatUsageClass(1, 2)).toBeUndefined();
    expect(parentSeatUsageClass(undefined, 2)).toBeUndefined();
  });
});

describe('parentChatGptSeatUsageCount', () => {
  test('counts default members and default pending invites as ChatGPT seat usage', () => {
    expect(
      parentChatGptSeatUsageCount({
        membersCache: [
          { userId: 'member-a', email: 'a@example.com', role: 'standard-user', seat: 'default' },
          { userId: 'member-b', email: 'b@example.com', role: 'standard-user', seat: 'usage_based' }
        ],
        pendingInvitesCache: [
          {
            inviteId: 'invite-a',
            email: 'c@example.com',
            role: 'standard-user',
            status: 0,
            seat: 'default',
            createdTime: '2026-07-07T00:00:00.000Z',
            isScimManaged: false
          },
          {
            inviteId: 'invite-b',
            email: 'd@example.com',
            role: 'standard-user',
            status: 0,
            seat: 'usage_based',
            createdTime: '2026-07-07T00:00:00.000Z',
            isScimManaged: false
          }
        ]
      })
    ).toBe(2);
  });

  test('keeps the count unknown until either cache exists', () => {
    expect(parentChatGptSeatUsageCount({})).toBeUndefined();
    expect(parentMemberAndInviteCount({})).toBeUndefined();
  });
});
