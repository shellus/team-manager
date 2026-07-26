import { describe, expect, test } from 'vitest';
import {
  buildParentDeleteLocation,
  parentAccountManagerStatusNeedsPolling,
  seatSlotProfileFromInviteValues
} from './ParentRoutes.js';

describe('seatSlotProfileFromInviteValues', () => {
  test('keeps customer seat metadata for Codex invitations', () => {
    expect(seatSlotProfileFromInviteValues({
      email: 'codex@example.com',
      seat: 'usage_based',
      remark: 'Codex 客户',
      expiresOn: '2026-09-01',
      expireRemove: false,
      expireReminder: true
    })).toEqual({
      remark: 'Codex 客户',
      expiresOn: '2026-09-01',
      expireRemove: false,
      expireReminder: true
    });
  });
});

describe('buildParentDeleteLocation', () => {
  test('selects the parent and opens its delete modal in one navigation', () => {
    const location = buildParentDeleteLocation(
      new URLSearchParams('q=owner&tags=gam%2Ccodex%2Cteam&tab=billing'),
      { id: 'parent-1', groupName: '客户 A' },
      '客户 A',
      'billing'
    );
    const params = new URLSearchParams(location.search);

    expect(location.pathname).toBe('/parents/parent-1');
    expect(params.get('group')).toBe('客户 A');
    expect(params.get('tab')).toBe('billing');
    expect(params.get('modal')).toBe('delete-parent');
    expect(params.get('target')).toBe('parent-1');
    expect(params.get('q')).toBe('owner');
    expect(params.get('tags')).toBe('gam,codex,team');
  });
});

describe('parentAccountManagerStatusNeedsPolling', () => {
  const status = {
    configured: true,
    reachable: true,
    managed: true,
    hasCodexSpace: false,
    hasTeamSubscription: false
  } as const;

  test('keeps polling while a successful 0.52 operation is not reflected in the account summary', () => {
    expect(parentAccountManagerStatusNeedsPolling({
      ...status,
      codexOperation: {
        id: 'codex-1',
        type: 'open_codex_space',
        status: 'succeeded',
        phase: 'complete',
        progress: 100,
        createdAt: 1,
        updatedAt: 2,
        completedAt: 2
      }
    })).toBe(true);
  });

  test('stops polling after the successful 0.52 result is reflected', () => {
    expect(parentAccountManagerStatusNeedsPolling({
      ...status,
      hasCodexSpace: true,
      codexOperation: {
        id: 'codex-1',
        type: 'open_codex_space',
        status: 'succeeded',
        phase: 'complete',
        progress: 100,
        createdAt: 1,
        updatedAt: 2,
        completedAt: 2
      }
    })).toBe(false);
  });
});
