import { describe, expect, test } from 'vitest';
import { buildSeatManagementUrl } from './seatSlotUrl.js';

describe('seatSlotUrl', () => {
  test('builds a full seat management URL for copy actions', () => {
    expect(buildSeatManagementUrl('AbCd1234EfGh5678', 'https://example.com')).toBe(
      'https://example.com/seat/AbCd1234EfGh5678'
    );
  });

  test('encodes the seat key path segment', () => {
    expect(buildSeatManagementUrl('key with space', 'https://example.com/root/')).toBe(
      'https://example.com/seat/key%20with%20space'
    );
  });
});
