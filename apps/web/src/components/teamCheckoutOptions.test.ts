import { describe, expect, test } from 'vitest';
import { billingCurrencyForCountry, parsePromotionTriplet } from './teamCheckoutOptions.js';

describe('Team checkout options', () => {
  test('parses the teamcode coupon country currency triplet', () => {
    expect(parsePromotionTriplet(' promo | uk | gbp ')).toEqual({
      promoCode: 'promo',
      country: 'GB',
      currency: 'GBP'
    });
  });

  test('uses the observed default billing currency for common countries', () => {
    expect(billingCurrencyForCountry('JP')).toBe('JPY');
    expect(billingCurrencyForCountry('US')).toBe('USD');
  });
});
