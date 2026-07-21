export const CHECKOUT_COUNTRY_CODES = `AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW`.split(' ');

export const CHECKOUT_CURRENCIES = [
  'USD', 'AUD', 'CAD', 'GBP', 'EUR', 'CLP', 'JPY', 'INR', 'IDR', 'PKR', 'THB',
  'MYR', 'TWD', 'VND', 'PHP', 'NGN', 'ZAR', 'KZT', 'TZS', 'EGP', 'BRL', 'SEK',
  'CZK', 'PLN', 'DKK', 'NOK', 'KRW', 'COP', 'MXN', 'PEN', 'HUF', 'QAR', 'RON',
  'ILS', 'AED', 'SGD', 'NZD', 'CHF', 'SAR'
] as const;

const COUNTRY_CURRENCY: Record<string, string> = {
  AE: 'AED', AT: 'EUR', AU: 'AUD', BE: 'EUR', BR: 'BRL', CA: 'CAD', CH: 'CHF',
  CL: 'CLP', CO: 'COP', CZ: 'CZK', DE: 'EUR', DK: 'DKK', EG: 'EGP', ES: 'EUR',
  FI: 'EUR', FR: 'EUR', GB: 'GBP', GR: 'EUR', HU: 'HUF', ID: 'IDR', IE: 'EUR',
  IL: 'ILS', IN: 'INR', IT: 'EUR', JP: 'JPY', KR: 'KRW', KZ: 'KZT', LT: 'EUR',
  LU: 'EUR', LV: 'EUR', MX: 'MXN', MY: 'MYR', NG: 'NGN', NL: 'EUR', NO: 'NOK',
  NZ: 'NZD', PE: 'PEN', PH: 'PHP', PK: 'PKR', PL: 'PLN', PT: 'EUR', QA: 'QAR',
  RO: 'RON', SA: 'SAR', SE: 'SEK', SG: 'SGD', TH: 'THB', TW: 'TWD', TZ: 'TZS',
  US: 'USD', VN: 'VND', ZA: 'ZAR'
};

export function billingCurrencyForCountry(country: string): string {
  return COUNTRY_CURRENCY[country.trim().toUpperCase()] || 'USD';
}
