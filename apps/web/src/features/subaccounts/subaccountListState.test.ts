import { describe, expect, test } from 'vitest';
import type { SubaccountView } from '@team-manager/shared';
import {
  resolveSubaccountDeleteTarget,
  sortSubaccountsForList,
  subaccountAfterRemoval
} from './subaccountListState.js';

function subaccount(input: Partial<SubaccountView> & Pick<SubaccountView, 'id' | 'email'>): SubaccountView {
  return {
    status: 'session_ready',
    hasWebSession: true,
    codexCredentials: [],
    teamLinks: [],
    createdAt: 1,
    updatedAt: 1,
    ...input
  };
}

describe('subaccount list state', () => {
  test('sorts subaccounts by the same remark-or-email rule as parents', () => {
    const sorted = sortSubaccountsForList([
      subaccount({ id: 'updated-last', email: 'zeta@example.com', updatedAt: 300 }),
      subaccount({ id: 'banned-last', email: 'aardvark@example.com', isBanned: true, updatedAt: 500 }),
      subaccount({ id: 'remark-first', email: 'child-b@example.com', remark: 'team 2', updatedAt: 100 }),
      subaccount({ id: 'email-middle', email: 'alpha@example.com', updatedAt: 200 }),
      subaccount({ id: 'numeric-after', email: 'child-a@example.com', remark: 'team 10', updatedAt: 400 })
    ]);

    expect(sorted.map((item) => item.id)).toEqual([
      'email-middle',
      'remark-first',
      'numeric-after',
      'updated-last',
      'banned-last'
    ]);
  });

  test('binds the delete dialog to the route target instead of the next selected row', () => {
    const deleted = subaccount({ id: 'delete-me', email: 'delete@example.com' });
    const nextSelected = subaccount({ id: 'next-row', email: 'next@example.com' });

    expect(resolveSubaccountDeleteTarget([nextSelected], nextSelected, deleted.id)).toBeNull();
    expect(resolveSubaccountDeleteTarget([deleted, nextSelected], nextSelected, deleted.id)).toBe(deleted);
  });

  test('chooses the next stable selection after deleting a subaccount', () => {
    const deleted = subaccount({ id: 'delete-me', email: 'delete@example.com' });
    const nextSelected = subaccount({ id: 'next-row', email: 'next@example.com' });

    expect(subaccountAfterRemoval([deleted, nextSelected], deleted.id)).toBe(nextSelected);
    expect(subaccountAfterRemoval([deleted], deleted.id)).toBeNull();
  });
});
