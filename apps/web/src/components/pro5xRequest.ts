import type { OpenPro5xRequest } from '@team-manager/shared';
import { parseCardExpiry } from './cardExpiry.js';

export interface Pro5xFormValues {
  cardQuickInput?: string;
  number?: string;
  expiry?: string;
  cvc?: string;
}

export const DEFAULT_PRO_5X_FORM_VALUES: Pro5xFormValues = {
  cardQuickInput: '',
  number: '',
  expiry: '',
  cvc: ''
};

export function buildPro5xRequest(values: Pro5xFormValues): OpenPro5xRequest {
  const expiry = parseCardExpiry(values.expiry || '');
  if (!expiry) throw new Error('Pro 5x 信用卡有效期无效');
  return {
    autoPay: true,
    card: {
      number: String(values.number ?? '').replace(/\s+/g, ''),
      ...expiry,
      cvc: String(values.cvc ?? '').trim()
    }
  };
}
