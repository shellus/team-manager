import { describe, expect, test } from 'vitest';
import type { SubaccountAccountManagerStatus } from '@team-manager/shared';
import { subaccountAccountManagerStatusNeedsPolling } from './SubaccountRoutes.js';

function status(
  patch: Partial<SubaccountAccountManagerStatus> = {}
): SubaccountAccountManagerStatus {
  return {
    configured: true,
    reachable: true,
    managed: false,
    hasPro5x: false,
    ...patch
  };
}

describe('subaccountAccountManagerStatusNeedsPolling', () => {
  test('keeps polling while a child is being imported into GAM', () => {
    expect(subaccountAccountManagerStatusNeedsPolling(status({
      enrollmentOperation: {
        id: 'import-1',
        type: 'import',
        status: 'running',
        phase: 'session_bootstrap',
        progress: 40,
        createdAt: 1,
        updatedAt: 2
      }
    }))).toBe(true);
  });

  test('stops polling after the GAM association is reconciled', () => {
    expect(subaccountAccountManagerStatusNeedsPolling(status({
      managed: true,
      accountEmail: 'child@example.com'
    }))).toBe(false);
  });
});
