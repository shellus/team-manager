import { describe, expect, it } from 'vitest';
import type { MaintainedTeamOrder } from '@team-manager/shared';
import { presentedTeamOrderStatus, teamOrderRemainingText, teamOrderRetryMode } from './teamOrderPresentation.js';

function order(overrides: Partial<MaintainedTeamOrder> = {}): MaintainedTeamOrder {
  return {
    id: 'order-1',
    accountId: 'account-1',
    source: 'scheduled',
    status: 'ready',
    scheduledFor: 1_000,
    workspaceId: 'workspace-1',
    workspaceName: 'Morgan Inc',
    config: { promoCode: '', country: 'US', currency: 'USD' },
    attemptCount: 1,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides
  };
}

describe('team order presentation', () => {
  it('derives expiring and expired without introducing a payment status', () => {
    const now = 10_000;
    expect(presentedTeamOrderStatus(order({ expiresAt: now + 3 * 60 * 60_000 }), now)).toBe('ready');
    expect(presentedTeamOrderStatus(order({ expiresAt: now + 60 * 60_000 }), now)).toBe('expiring');
    expect(presentedTeamOrderStatus(order({ expiresAt: now - 1 }), now)).toBe('expired');
  });

  it('formats remaining order validity from Stripe expires_at', () => {
    const now = 10_000;
    expect(teamOrderRemainingText(now + 2 * 60 * 60_000 + 5 * 60_000, now)).toBe('2小时5分钟');
    expect(teamOrderRemainingText(now - 1, now)).toBe('已过期');
  });

  it('offers expedite only for an automatic retry wait and regenerate for terminal failures', () => {
    expect(teamOrderRetryMode(order({ status: 'queued', attemptCount: 3, retryAt: 20_000 }))).toBe('expedite');
    expect(teamOrderRetryMode(order({ status: 'failed' }))).toBe('regenerate');
    expect(teamOrderRetryMode(order({ status: 'running' }))).toBeNull();
    expect(teamOrderRetryMode(order({ status: 'queued', attemptCount: 0 }))).toBeNull();
  });
});
