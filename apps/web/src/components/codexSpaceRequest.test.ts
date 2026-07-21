import { describe, expect, it } from 'vitest';
import {
  buildCodexSpaceRequest,
  DEFAULT_CODEX_SPACE_FORM_VALUES
} from './codexSpaceRequest.js';

describe('buildCodexSpaceRequest', () => {
  it('uses Italy, EUR and 16 credits by default', () => {
    expect(buildCodexSpaceRequest({
      ...DEFAULT_CODEX_SPACE_FORM_VALUES,
      number: '4242 4242 4242 4242',
      expiry: '07/28',
      cvc: '123'
    })).toEqual({
      country: 'IT',
      currency: 'EUR',
      credits: 16,
      card: {
        number: '4242424242424242',
        expiryMonth: 7,
        expiryYear: 2028,
        cvc: '123'
      }
    });
  });
});
