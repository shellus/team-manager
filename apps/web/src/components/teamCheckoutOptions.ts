import {
  billingCurrencyForCountry,
  CHECKOUT_COUNTRY_CODES,
  CHECKOUT_CURRENCIES
} from '@team-manager/shared';

export { billingCurrencyForCountry };

export const TEAM_CHECKOUT_CURRENCIES = CHECKOUT_CURRENCIES;

const regionNames = typeof Intl.DisplayNames === 'function'
  ? new Intl.DisplayNames(['zh-CN'], { type: 'region' })
  : undefined;

export const ACCOUNT_PROXY_COUNTRIES = CHECKOUT_COUNTRY_CODES.map((code) => ({
  value: code,
  label: `${code} · ${regionNames?.of(code) || code}`
}));

export const TEAM_CHECKOUT_COUNTRIES = CHECKOUT_COUNTRY_CODES.map((code) => ({
  value: code,
  label: `${code}.${billingCurrencyForCountry(code)} · ${regionNames?.of(code) || code}`
}));

export function parsePromotionTriplet(value: string): {
  promoCode: string;
  country?: string;
  currency?: string;
} {
  const [promoCode, rawCountry, rawCurrency] = value.split('|').map((part) => part.trim());
  const country = (rawCountry || '').toUpperCase() === 'UK' ? 'GB' : (rawCountry || '').toUpperCase();
  const currency = (rawCurrency || '').toUpperCase();
  return {
    promoCode,
    ...(/^[A-Z]{2}$/.test(country) ? { country } : {}),
    ...(/^[A-Z]{3}$/.test(currency) ? { currency } : {})
  };
}
