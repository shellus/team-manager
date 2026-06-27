import { BILLING_RISK_CONFIRM_MESSAGE } from '@team-manager/shared';
import { ApiError } from '../api.js';

export function formatDateTime(value?: number | string): string {
  if (!value) return '暂无';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', { hour12: false });
}

export function formatRelativeTime(value?: number): string {
  if (!value) return '暂无';
  const seconds = Math.max(0, Math.floor((Date.now() - value) / 1000));
  if (seconds < 60) return `${seconds} 秒前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

export function shortText(value: string, max = 120): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

export function isBillingRiskError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && error.message === BILLING_RISK_CONFIRM_MESSAGE;
}

export function parseJsonObject(raw: string): Record<string, unknown> {
  const parsed = parseJsonValue(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JSON 必须是对象');
  }
  return parsed as Record<string, unknown>;
}

export function parseJsonValue(raw: string): unknown {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed;
  } catch (error) {
    throw new Error('JSON 解析失败，请检查格式');
  }
}

export function readStringField(payload: unknown, key: string): string {
  if (!payload || typeof payload !== 'object') return '';
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}
