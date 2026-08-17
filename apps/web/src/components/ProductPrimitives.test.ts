import { describe, expect, test } from 'vitest';
import { formatPaymentCardLast4 } from './ProductPrimitives.js';

describe('product primitive formatters', () => {
  test('only formats a four-digit payment card suffix', () => {
    expect(formatPaymentCardLast4('4242')).toBe('•••• 4242');
    expect(formatPaymentCardLast4(' 1234 ')).toBe('•••• 1234');
    expect(formatPaymentCardLast4('12345')).toBeUndefined();
    expect(formatPaymentCardLast4()).toBeUndefined();
  });
});
