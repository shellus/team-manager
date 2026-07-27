import { describe, expect, test } from 'vitest';
import { buildPro5xRequest } from './pro5xRequest.js';

describe('Pro 5x request', () => {
  test('normalizes the required card and always enables automatic payment', () => {
    expect(buildPro5xRequest({
      number: '4242 4242 4242 4242',
      expiry: '07/28',
      cvc: '123'
    })).toEqual({
      autoPay: true,
      card: {
        number: '4242424242424242',
        expiryMonth: 7,
        expiryYear: 2028,
        cvc: '123'
      }
    });
  });
});
