import { describe, expect, test } from 'vitest';
import {
  normalizeResidentialProxyAsn,
  proxyLocationForCountry
} from './ResidentialProxyConfigurationPanel.js';

describe('ResidentialProxyConfigurationPanel', () => {
  test('clears stale state and city when the country changes', () => {
    expect(proxyLocationForCountry('SG')).toEqual({
      country: 'SG',
      state: null,
      city: null
    });
  });

  test('normalizes ASN values used by the upstream username', () => {
    expect(normalizeResidentialProxyAsn('64512')).toBe('AS64512');
    expect(normalizeResidentialProxyAsn('as64512')).toBe('AS64512');
    expect(normalizeResidentialProxyAsn('')).toBeNull();
  });

  test('rejects malformed and out-of-range ASN values', () => {
    expect(() => normalizeResidentialProxyAsn('ASN64512')).toThrow('ASN 必须是 AS 加数字');
    expect(() => normalizeResidentialProxyAsn('AS4294967296')).toThrow('ASN 超出有效范围');
  });
});
