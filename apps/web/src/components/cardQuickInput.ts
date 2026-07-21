import { normalizeCardExpiryInput, parseCardExpiry } from './cardExpiry.js';

export interface ParsedCardQuickInput {
  number: string;
  expiry: string;
  cvc: string;
}

export function parseCardQuickInput(value: string): ParsedCardQuickInput | undefined {
  const parts = value.split(/\s*----\s*/);
  if (parts.length !== 3) return undefined;

  const number = parts[0]!.replace(/\s+/g, '');
  const expiry = normalizeCardExpiryInput(parts[1]!);
  const cvc = parts[2]!.trim();
  if (!/^\d{12,19}$/.test(number) || !parseCardExpiry(expiry) || !/^\d{3,4}$/.test(cvc)) {
    return undefined;
  }
  return { number, expiry, cvc };
}
