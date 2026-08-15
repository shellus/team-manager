import { CHECKOUT_COUNTRY_CODES, CHECKOUT_CURRENCIES } from '@team-manager/shared';

/** Checkout 相关表单共用选项，避免每个页面重复映射并产生顺序差异。 */
export const CHECKOUT_COUNTRY_OPTIONS = CHECKOUT_COUNTRY_CODES.map((value) => ({
  value,
  label: value,
}));

export const CHECKOUT_CURRENCY_OPTIONS = CHECKOUT_CURRENCIES.map((value) => ({
  value,
  label: value,
}));

export const SNAPSHOT_BOOLEAN_OPTIONS = [
  { value: true, label: '明确开启' },
  { value: false, label: '明确关闭' },
];
