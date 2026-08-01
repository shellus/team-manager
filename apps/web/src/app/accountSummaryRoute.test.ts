import { describe, expect, test } from 'vitest';
import { routeNeedsAccountSummaries } from './accountSummaryRoute.js';

describe('routeNeedsAccountSummaries', () => {
  test('loads parent summaries only for routes that consume them', () => {
    expect(routeNeedsAccountSummaries('/parents')).toBe(true);
    expect(routeNeedsAccountSummaries('/parents/account-1')).toBe(true);
    expect(routeNeedsAccountSummaries('/subaccounts')).toBe(true);
    expect(routeNeedsAccountSummaries('/overview')).toBe(false);
    expect(routeNeedsAccountSummaries('/team-orders')).toBe(false);
  });
});
