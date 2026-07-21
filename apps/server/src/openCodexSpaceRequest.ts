import {
  CHECKOUT_COUNTRY_CODES,
  CHECKOUT_CURRENCIES,
  type OpenCodexSpaceRequest
} from '@team-manager/shared';
import { ServiceError } from './teamService.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredCode(value: unknown, field: string, length: number): string {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!new RegExp(`^[A-Z]{${length}}$`).test(normalized)) {
    throw new ServiceError(400, `${field}必须是 ${length} 位字母代码`);
  }
  return normalized;
}

function requiredInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value)) throw new ServiceError(400, `${field}必须是整数`);
  return value as number;
}

/** 0.52 开通接口边界：拒绝缺省和不完整卡片，不在后端静默补默认值。 */
export function parseOpenCodexSpaceRequest(raw: unknown, now = new Date()): OpenCodexSpaceRequest {
  if (!isRecord(raw)) throw new ServiceError(400, '开通参数必须是 JSON 对象');

  const country = requiredCode(raw.country, '国家', 2);
  if (!CHECKOUT_COUNTRY_CODES.includes(country)) throw new ServiceError(400, `不支持的国家代码: ${country}`);
  const currency = requiredCode(raw.currency, '账单货币', 3);
  if (!(CHECKOUT_CURRENCIES as readonly string[]).includes(currency)) {
    throw new ServiceError(400, `不支持的账单货币: ${currency}`);
  }
  const credits = requiredInteger(raw.credits, '积分数量');
  if (credits <= 0) throw new ServiceError(400, '积分数量必须大于 0');

  if (!isRecord(raw.card)) throw new ServiceError(400, '缺少完整的信用卡信息');
  const number = typeof raw.card.number === 'string' ? raw.card.number.replace(/\s+/g, '') : '';
  if (!/^\d{12,19}$/.test(number)) throw new ServiceError(400, '卡号应为 12 至 19 位数字');

  const expiryMonth = requiredInteger(raw.card.expiryMonth, '有效期月份');
  if (expiryMonth < 1 || expiryMonth > 12) throw new ServiceError(400, '有效期月份必须在 1 至 12 之间');
  const expiryYear = requiredInteger(raw.card.expiryYear, '有效期年份');
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  if (
    expiryYear < currentYear
    || expiryYear > currentYear + 20
    || (expiryYear === currentYear && expiryMonth < currentMonth)
  ) {
    throw new ServiceError(400, '信用卡有效期已过期或超出可接受范围');
  }

  const cvc = typeof raw.card.cvc === 'string' ? raw.card.cvc.trim() : '';
  if (!/^\d{3,4}$/.test(cvc)) throw new ServiceError(400, 'CVC 应为 3 或 4 位数字');

  return {
    country,
    currency,
    credits,
    card: { number, expiryMonth, expiryYear, cvc }
  };
}
