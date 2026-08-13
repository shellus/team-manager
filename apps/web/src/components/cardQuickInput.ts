import type { PaymentCardInput } from '@team-manager/shared';

export function parseCardQuickInput(value: string): PaymentCardInput | undefined {
  const [numberValue, expiryValue, cvcValue, ...rest] = value.trim().split(/\s*----\s*/u);
  if (rest.length || !numberValue || !expiryValue || !cvcValue) return undefined;
  const number = numberValue.replace(/\s+/gu, '');
  const match = /^(\d{1,2})\/(\d{2}|\d{4})$/.exec(expiryValue.trim());
  const cvc = cvcValue.trim();
  if (!/^\d{12,19}$/.test(number) || !match || !/^\d{3,4}$/.test(cvc)) return undefined;
  const expiryMonth = Number(match[1]);
  const expiryYear = match[2].length === 2 ? 2000 + Number(match[2]) : Number(match[2]);
  if (expiryMonth < 1 || expiryMonth > 12) return undefined;
  return { number, expiryMonth, expiryYear, cvc };
}
