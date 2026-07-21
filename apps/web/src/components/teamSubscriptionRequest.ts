import type { OpenTeamSubscriptionRequest } from '@team-manager/shared';
import { parseCardExpiry } from './cardExpiry.js';
import { parsePromotionTriplet } from './teamCheckoutOptions.js';

export interface TeamSubscriptionFormValues {
  workspaceId?: string;
  promotion?: string;
  country: string;
  currency: string;
  autoPay: boolean;
  number?: string;
  expiry?: string;
  cvc?: string;
}

export const DEFAULT_TEAM_SUBSCRIPTION_FORM_VALUES: TeamSubscriptionFormValues = {
  workspaceId: undefined,
  promotion: '',
  country: 'US',
  currency: 'USD',
  autoPay: false,
  number: '',
  expiry: '',
  cvc: ''
};

export function buildTeamSubscriptionRequest(
  values: TeamSubscriptionFormValues
): OpenTeamSubscriptionRequest {
  const number = values.number?.replace(/\s+/g, '') || '';
  const expiry = values.expiry ? parseCardExpiry(values.expiry) : undefined;
  const promotion = parsePromotionTriplet(values.promotion || '');
  return {
    workspaceId: values.workspaceId || undefined,
    promoCode: promotion.promoCode || undefined,
    country: promotion.country || values.country,
    currency: promotion.currency || values.currency,
    autoPay: values.autoPay === true,
    ...(number && expiry && values.cvc
      ? { card: { number, ...expiry, cvc: values.cvc.trim() } }
      : {})
  };
}
