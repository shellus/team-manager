import { describe, expect, test } from 'vitest';
import {
  buildParentAfterDeleteLocation,
  buildParentDeleteLocation,
  clearStaleParentDeleteState,
  parentAccountManagerStatusNeedsPolling,
  seatSlotProfileFromInviteValues
} from './ParentRoutes.js';

describe('seatSlotProfileFromInviteValues', () => {
  test('keeps customer seat metadata for Codex invitations', () => {
    expect(seatSlotProfileFromInviteValues({
      email: 'codex@example.com',
      seat: 'usage_based',
      contact: '微信[客户]',
      remark: 'Codex 客户',
      price: '120元',
      expiresOn: '2026-09-01',
      expireRemove: false,
      expireReminder: true
    })).toEqual({
      contact: '微信[客户]',
      remark: 'Codex 客户',
      price: '120元',
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

describe('buildParentAfterDeleteLocation', () => {
  test('moves to the next visible parent and clears stale modal state', () => {
    const location = buildParentAfterDeleteLocation(
      new URLSearchParams('group=%E5%AE%A2%E6%88%B7+A&tab=billing&modal=delete-parent&target=parent-1'),
      [{ id: 'parent-1' }, { id: 'parent-2' }],
      'parent-1'
    );
    const params = new URLSearchParams(location.search);

    expect(location.pathname).toBe('/parents/parent-2');
    expect(params.get('group')).toBe('客户 A');
    expect(params.get('tab')).toBe('billing');
    expect(params.has('modal')).toBe(false);
    expect(params.has('target')).toBe(false);
  });

  test('returns to the parent route when the deleted parent was the last visible one', () => {
    expect(buildParentAfterDeleteLocation(
      new URLSearchParams('modal=delete-parent&target=parent-1'),
      [{ id: 'parent-1' }],
      'parent-1'
    )).toEqual({ pathname: '/parents', search: '' });
  });
});

describe('clearStaleParentDeleteState', () => {
  test('clears a delete modal that still targets the removed parent', () => {
    const params = clearStaleParentDeleteState(
      new URLSearchParams('tab=members&modal=delete-parent&target=parent-1'),
      'delete-parent',
      'parent-1',
      'parent-2'
    );

    expect(params.toString()).toBe('tab=members');
  });

  test('keeps the delete modal while its parent is still selected', () => {
    const params = clearStaleParentDeleteState(
      new URLSearchParams('tab=members&modal=delete-parent&target=parent-1'),
      'delete-parent',
      'parent-1',
      'parent-1'
    );

    expect(params.get('modal')).toBe('delete-parent');
    expect(params.get('target')).toBe('parent-1');
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

  test('keeps polling until a successful Pro 5x operation is reflected in the personal plan', () => {
    expect(parentAccountManagerStatusNeedsPolling({
      ...status,
      hasPro5x: false,
      pro5xOperation: {
        id: 'pro5x-1',
        type: 'open_pro_5x',
        status: 'succeeded',
        phase: 'complete',
        progress: 100,
        createdAt: 1,
        updatedAt: 2,
        completedAt: 2
      }
    })).toBe(true);

    expect(parentAccountManagerStatusNeedsPolling({
      ...status,
      hasPro5x: true,
      pro5xOperation: {
        id: 'pro5x-1',
        type: 'open_pro_5x',
        status: 'succeeded',
        phase: 'complete',
        progress: 100,
        createdAt: 1,
        updatedAt: 2,
        completedAt: 2
      }
    })).toBe(false);
  });

  test('keeps polling while an existing parent is being enrolled into GAM', () => {
    expect(parentAccountManagerStatusNeedsPolling({
      ...status,
      managed: false,
      enrollmentOperation: {
        id: 'import-1',
        type: 'import',
        status: 'running',
        phase: 'login_opening',
        progress: 10,
        createdAt: 1,
        updatedAt: 2
      }
    })).toBe(true);
  });

  test('stops polling after the GAM import is reflected as managed', () => {
    expect(parentAccountManagerStatusNeedsPolling({
      ...status,
      enrollmentOperation: {
        id: 'import-1',
        type: 'import',
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
