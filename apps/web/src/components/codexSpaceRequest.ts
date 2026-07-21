import type { OpenCodexSpaceRequest } from '@team-manager/shared';
import { parseCardExpiry } from './cardExpiry.js';

export interface CodexSpaceFormValues {
  country: string;
  currency: string;
  credits: number;
  cardQuickInput?: string;
  number: string;
  expiry: string;
  cvc: string;
}

export const DEFAULT_CODEX_SPACE_FORM_VALUES: CodexSpaceFormValues = {
  country: 'IT',
  currency: 'EUR',
  credits: 16,
  cardQuickInput: '',
  number: '',
  expiry: '',
  cvc: ''
};

export function buildCodexSpaceRequest(values: CodexSpaceFormValues): OpenCodexSpaceRequest {
  const expiry = parseCardExpiry(values.expiry);
  if (!expiry) throw new Error('有效期格式无效');
  return {
    country: values.country,
    currency: values.currency,
    credits: values.credits,
    card: {
      number: values.number.replace(/\s+/g, ''),
      ...expiry,
      cvc: values.cvc.trim()
    }
  };
}
