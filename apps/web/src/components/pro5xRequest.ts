import type { OpenPro5xRequest } from '@team-manager/shared';
import { parseCardExpiry } from './cardExpiry.js';

export interface Pro5xFormValues {
  usePromoCode: boolean;
  promoCode?: string;
  cardQuickInput?: string;
  number?: string;
  expiry?: string;
  cvc?: string;
}

export const DEFAULT_PRO_5X_PROMO_CODE = 'stb';

export const DEFAULT_PRO_5X_FORM_VALUES: Pro5xFormValues = {
  usePromoCode: true,
  promoCode: DEFAULT_PRO_5X_PROMO_CODE,
  cardQuickInput: '',
  number: '',
  expiry: '',
  cvc: ''
};

export function createPro5xFormValues(
  mode: 'open' | 'resume',
  defaultPromoCode?: string,
  defaultUsePromoCode = true
): Pro5xFormValues {
  return {
    ...DEFAULT_PRO_5X_FORM_VALUES,
    usePromoCode: mode === 'open' && defaultUsePromoCode,
    promoCode: mode === 'open' ? resolvePro5xPromoCode(defaultPromoCode) : ''
  };
}

export function resolvePro5xPromoCode(value?: string): string {
  return String(value ?? '').trim() || DEFAULT_PRO_5X_PROMO_CODE;
}

export function buildPro5xRequest(values: Pro5xFormValues): OpenPro5xRequest {
  const expiry = parseCardExpiry(values.expiry || '');
  if (!expiry) throw new Error('Pro 5x 信用卡有效期无效');
  const usePromoCode = values.usePromoCode !== false;
  const promoCode = String(values.promoCode ?? '').trim();
  if (usePromoCode && !promoCode) throw new Error('请输入 Pro 5x 优惠码');
  return {
    autoPay: true,
    usePromoCode,
    ...(promoCode ? { promoCode } : {}),
    card: {
      number: String(values.number ?? '').replace(/\s+/g, ''),
      ...expiry,
      cvc: String(values.cvc ?? '').trim()
    }
  };
}
