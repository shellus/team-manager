import { describe, expect, test } from 'vitest';
import { normalizeCardExpiryInput, parseCardExpiry } from './cardExpiry.js';

const now = new Date('2026-07-20T00:00:00Z');

describe('card expiry input', () => {
  test.each([
    ['07/28', { expiryMonth: 7, expiryYear: 2028 }],
    ['07/2028', { expiryMonth: 7, expiryYear: 2028 }],
    [' 12 / 30 ', { expiryMonth: 12, expiryYear: 2030 }]
  ])('parses %s', (value, expected) => {
    expect(parseCardExpiry(value, now)).toEqual(expected);
  });

  test.each(['7/28', '13/28', '06/26', '07/47', '0728', ''])('rejects %s', (value) => {
    expect(parseCardExpiry(value, now)).toBeUndefined();
  });

  test.each([
    ['07', '07'],
    ['0728', '07/28'],
    ['07/2028', '07/2028'],
    ['07 2028', '07/2028'],
    ['07202899', '07/2028']
  ])('normalizes %s to %s', (value, expected) => {
    expect(normalizeCardExpiryInput(value)).toBe(expected);
  });
});
