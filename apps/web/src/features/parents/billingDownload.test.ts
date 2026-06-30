import { describe, expect, test } from 'vitest';
import type { AccountBillingSnapshot, AccountView } from '@team-manager/shared';
import { buildBillingSnapshotDownload } from './billingDownload.js';

const account = {
  id: 'account-1',
  email: 'Owner+Team@example.com',
  remark: 'CPA A',
  groupName: 'default',
  limitType: 'unknown',
  accountId: 'workspace-main'
} satisfies AccountView;

describe('billingDownload', () => {
  test('builds a safe raw billing snapshot JSON download', () => {
    const snapshot = {
      accountId: 'account-1',
      workspaceAccountId: 'workspace-main',
      refreshedAt: Date.UTC(2026, 5, 30, 8, 12, 13, 456),
      raw: {
        invoices: { items: [{ id: 'invoice-1' }] },
        paymentMethods: { data: [] },
        billingInfo: { name: 'Shellus' },
        seatTypeCounts: { default: 2, usage_based: 1 }
      }
    } satisfies AccountBillingSnapshot;

    const download = buildBillingSnapshotDownload(account, snapshot);

    expect(download.fileName).toBe('cpa-a-workspace-main-billing-2026-06-30T08-12-13-456Z.json');
    expect(download.content).toBe(`${JSON.stringify(snapshot.raw, null, 2)}\n`);
    expect(download.mimeType).toBe('application/json;charset=utf-8');
  });
});
