import type { OpenCodexSpaceRequest } from '@team-manager/shared';
import { parseCardExpiry } from './cardExpiry.js';

export interface CodexSpaceFormValues {
  country?: string;
  currency?: string;
  credits?: number;
  cardQuickInput?: string;
  number: string;
  expiry: string;
  cvc: string;
}

export const EMPTY_CODEX_SPACE_FORM_VALUES: CodexSpaceFormValues = {
  country: undefined,
  currency: undefined,
  credits: undefined,
  cardQuickInput: '',
  number: '',
  expiry: '',
  cvc: ''
};

export const CODEX_SPACE_ORDER_PRESETS = {
  us: {
    country: 'US',
    currency: 'USD',
    credits: 13
  },
  eu: {
    country: 'IT',
    currency: 'EUR',
    credits: 16
  }
} as const;

export function buildCodexSpaceRequest(values: CodexSpaceFormValues): OpenCodexSpaceRequest {
  const country = values.country?.trim().toUpperCase() || '';
  const currency = values.currency?.trim().toUpperCase() || '';
  const credits = Number(values.credits);
  if (!/^[A-Z]{2}$/.test(country)) throw new Error('国家配置无效');
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('账单货币配置无效');
  if (!Number.isSafeInteger(credits) || credits <= 0) throw new Error('积分数量必须是正整数');
  const expiry = parseCardExpiry(values.expiry);
  if (!expiry) throw new Error('有效期格式无效');
  return {
    country,
    currency,
    credits,
    card: {
      number: values.number.replace(/\s+/g, ''),
      ...expiry,
      cvc: values.cvc.trim()
    }
  };
}
