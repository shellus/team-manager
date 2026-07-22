import { describe, expect, it } from 'vitest';
import {
  buildCodexSpaceRequest,
  CODEX_SPACE_ORDER_PRESETS,
  EMPTY_CODEX_SPACE_FORM_VALUES
} from './codexSpaceRequest.js';

describe('buildCodexSpaceRequest', () => {
  it('starts with an empty order configuration and exposes both explicit presets', () => {
    expect(EMPTY_CODEX_SPACE_FORM_VALUES).toMatchObject({
      country: undefined,
      currency: undefined,
      credits: undefined
    });
    expect(CODEX_SPACE_ORDER_PRESETS).toEqual({
      us: { country: 'US', currency: 'USD', credits: 13 },
      eu: { country: 'IT', currency: 'EUR', credits: 16 }
    });
  });

  it('builds a request from the selected Europe preset', () => {
    expect(buildCodexSpaceRequest({
      ...EMPTY_CODEX_SPACE_FORM_VALUES,
      ...CODEX_SPACE_ORDER_PRESETS.eu,
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

  it('rejects submission while the order configuration is still empty', () => {
    expect(() => buildCodexSpaceRequest({
      ...EMPTY_CODEX_SPACE_FORM_VALUES,
      number: '4242 4242 4242 4242',
      expiry: '07/28',
      cvc: '123'
    })).toThrow('国家配置无效');
  });
});
