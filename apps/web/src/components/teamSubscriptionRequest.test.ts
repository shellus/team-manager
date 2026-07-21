import { describe, expect, test } from 'vitest';
import {
  buildTeamSubscriptionRequest,
  DEFAULT_TEAM_SUBSCRIPTION_FORM_VALUES
} from './teamSubscriptionRequest.js';

describe('Team subscription request', () => {
  test('creates a new Team order and leaves automatic payment disabled by default', () => {
    expect(buildTeamSubscriptionRequest(DEFAULT_TEAM_SUBSCRIPTION_FORM_VALUES)).toEqual({
      workspaceId: undefined,
      promoCode: undefined,
      country: 'US',
      currency: 'USD',
      autoPay: false
    });
  });

  test('keeps the selected workspace and explicit automatic payment choice', () => {
    expect(buildTeamSubscriptionRequest({
      ...DEFAULT_TEAM_SUBSCRIPTION_FORM_VALUES,
      workspaceId: 'workspace-usage-based',
      promotion: 'PROMO|GB|GBP',
      autoPay: true
    })).toEqual({
      workspaceId: 'workspace-usage-based',
      promoCode: 'PROMO',
      country: 'GB',
      currency: 'GBP',
      autoPay: true
    });
  });
});
