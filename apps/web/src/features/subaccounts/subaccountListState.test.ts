import { describe, expect, test } from 'vitest';
import { subaccountSummaryFromView, type SubaccountView } from '@team-manager/shared';
import {
  resolveSubaccountDeleteTarget,
  sortSubaccountsForList,
  subaccountAfterRemoval,
  visibleSubaccountRegistrationJobs
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

  test('places running Profiles first and keeps the existing name order inside each group', () => {
    const runningB = subaccount({ id: 'running-b', email: 'beta@example.com' });
    const stoppedA = subaccount({ id: 'stopped-a', email: 'alpha@example.com' });
    const runningA = subaccount({ id: 'running-a', email: 'aardvark@example.com' });
    const sorted = sortSubaccountsForList([runningB, stoppedA, runningA], {
      [runningA.id]: { accountId: runningA.email, status: 'running', updatedAt: 1 },
      [runningB.id]: { accountId: runningB.email, status: 'running', updatedAt: 1 },
      [stoppedA.id]: { accountId: stoppedA.email, status: 'stopped', updatedAt: 1 }
    });

    expect(sorted.map((item) => item.id)).toEqual(['running-a', 'running-b', 'stopped-a']);
  });

  test('chooses the next stable selection after deleting a subaccount', () => {
    const deleted = subaccount({ id: 'delete-me', email: 'delete@example.com' });
    const nextSelected = subaccount({ id: 'next-row', email: 'next@example.com' });

    expect(subaccountAfterRemoval([deleted, nextSelected], deleted.id)).toBe(nextSelected);
    expect(subaccountAfterRemoval([deleted], deleted.id)).toBeNull();
  });

  test('keeps only registration jobs that should appear in the child list', () => {
    const healthy = subaccount({ id: 'healthy', email: 'healthy@example.com' });
    const retryable = subaccount({
      id: 'retryable',
      email: 'retryable@example.com',
      status: 'error'
    });
    const jobs = [
      {
        id: 'active', status: 'running' as const, phase: 'registration_running', message: '注册中',
        progress: 50, groupName: 'A', createdAt: 1, updatedAt: 1
      },
      {
        id: 'linked-healthy', status: 'failed' as const, phase: 'registration_failed', message: '失败',
        progress: 100, subaccountId: healthy.id, groupName: 'A', createdAt: 1, updatedAt: 1
      },
      {
        id: 'linked-retryable', status: 'failed' as const, phase: 'registration_failed', message: '失败',
        progress: 100, subaccountId: retryable.id, groupName: 'B', createdAt: 1, updatedAt: 1
      },
      {
        id: 'completed', status: 'succeeded' as const, phase: 'registration_succeeded', message: '完成',
        progress: 100, groupName: 'B', createdAt: 1, updatedAt: 1
      }
    ];

    expect(visibleSubaccountRegistrationJobs(
      jobs,
      [healthy, retryable].map(subaccountSummaryFromView)
    ).map((job) => job.id))
      .toEqual(['active', 'linked-retryable']);
  });
});
