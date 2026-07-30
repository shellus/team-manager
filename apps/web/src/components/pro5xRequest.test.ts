import { describe, expect, test } from 'vitest';
import {
  buildPro5xRequest,
  createPro5xFormValues,
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

  test('recreates the promotion defaults whenever the opening form is mounted again', () => {
    expect(createPro5xFormValues('open')).toMatchObject({
      usePromoCode: true,
      promoCode: 'stb'
    });
    expect(createPro5xFormValues('open', '')).toMatchObject({
      usePromoCode: true,
      promoCode: 'stb'
    });
    expect(createPro5xFormValues('open', 'saved-code', false)).toMatchObject({
      usePromoCode: false,
      promoCode: 'saved-code'
    });
    expect(createPro5xFormValues('resume', 'ignored')).toMatchObject({
      usePromoCode: false,
      promoCode: ''
    });
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

  test('keeps the saved code while marking the checkout as promotion-disabled', () => {
    expect(buildPro5xRequest({
      usePromoCode: false,
      promoCode: 'current-promo',
      number: '4242 4242 4242 4242',
      expiry: '07/28',
      cvc: '123'
    })).toEqual({
      autoPay: true,
      usePromoCode: false,
      promoCode: 'current-promo',
      card: {
        number: '4242424242424242',
        expiryMonth: 7,
        expiryYear: 2028,
        cvc: '123'
      }
    });
  });
});
