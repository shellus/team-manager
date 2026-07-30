import { describe, expect, test } from 'vitest';
import {
  buildPro5xRequest,
  DEFAULT_PRO_5X_FORM_VALUES,
  DEFAULT_PRO_5X_PROMO_CODE,
  resolvePro5xPromoCode
} from './pro5xRequest.js';

describe('Pro 5x request', () => {
  test('defaults the promotion switch to stb without depending on runtime status', () => {
    expect(DEFAULT_PRO_5X_FORM_VALUES.usePromoCode).toBe(true);
    expect(DEFAULT_PRO_5X_FORM_VALUES.promoCode).toBe('stb');
    expect(DEFAULT_PRO_5X_PROMO_CODE).toBe('stb');
    expect(resolvePro5xPromoCode()).toBe('stb');
    expect(resolvePro5xPromoCode('  custom  ')).toBe('custom');
  });

  test('normalizes the required card and always enables automatic payment', () => {
    expect(buildPro5xRequest({
      usePromoCode: true,
      promoCode: ' current-promo ',
      number: '4242 4242 4242 4242',
      expiry: '07/28',
      cvc: '123'
    })).toEqual({
      autoPay: true,
      usePromoCode: true,
      promoCode: 'current-promo',
      card: {
        number: '4242424242424242',
        expiryMonth: 7,
        expiryYear: 2028,
        cvc: '123'
      }
    });
  });

  test('omits the promotion code when the switch is disabled', () => {
    expect(buildPro5xRequest({
      usePromoCode: false,
      promoCode: 'current-promo',
      number: '4242 4242 4242 4242',
      expiry: '07/28',
      cvc: '123'
    })).toEqual({
      autoPay: true,
      usePromoCode: false,
      card: {
        number: '4242424242424242',
        expiryMonth: 7,
        expiryYear: 2028,
        cvc: '123'
      }
    });
  });
});
