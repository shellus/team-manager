export interface ParsedCardExpiry {
  expiryMonth: number;
  expiryYear: number;
}

export function normalizeCardExpiryInput(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '').slice(0, 6);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

export function parseCardExpiry(value: unknown, now = new Date()): ParsedCardExpiry | undefined {
  const match = String(value ?? '').trim().match(/^(0[1-9]|1[0-2])\s*\/\s*(\d{2}|\d{4})$/);
  if (!match) return undefined;
  const expiryMonth = Number(match[1]);
  const rawYear = Number(match[2]);
  const expiryYear = match[2]!.length === 2 ? 2_000 + rawYear : rawYear;
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  if (expiryYear < currentYear || expiryYear > currentYear + 20) return undefined;
  if (expiryYear === currentYear && expiryMonth < currentMonth) return undefined;
  return { expiryMonth, expiryYear };
}
