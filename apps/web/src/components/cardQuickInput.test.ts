import { describe, expect, it } from 'vitest';
import { parseCardQuickInput } from './cardQuickInput.js';

describe('parseCardQuickInput', () => {
  it('parses MM/YY card shortcuts', () => {
    expect(parseCardQuickInput('4242 4242 4242 4242----07/28----123')).toEqual({
      number: '4242424242424242',
      expiry: '07/28',
      cvc: '123'
    });
  });

  it('parses MM/YYYY card shortcuts with surrounding spaces', () => {
    expect(parseCardQuickInput(' 4242424242424242 ---- 12/2030 ---- 1234 ')).toEqual({
      number: '4242424242424242',
      expiry: '12/2030',
      cvc: '1234'
    });
  });

  it('does not partially fill invalid shortcuts', () => {
    expect(parseCardQuickInput('4242424242424242----13/28----123')).toBeUndefined();
    expect(parseCardQuickInput('4242424242424242|07/28|123')).toBeUndefined();
  });
});
