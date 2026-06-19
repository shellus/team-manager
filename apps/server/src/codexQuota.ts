import type { CodexCredentialJson, CodexQuotaSnapshot, QuotaWindow } from '@team-manager/shared';
import { createTransport, type Transport } from './transport.js';

const FIVE_HOUR_SECONDS = 18_000;
const WEEK_SECONDS = 604_800;
const MONTH_SECONDS_MIN = 28 * 24 * 60 * 60;
const MONTH_SECONDS_MAX = 32 * 24 * 60 * 60;

export const CODEX_USAGE_PATH = '/backend-api/wham/usage';

export async function fetchCodexQuota(
  credential: CodexCredentialJson,
  transport: Transport = createTransport()
): Promise<CodexQuotaSnapshot> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${credential.access_token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'codex_cli_rs/0.76.0 team-manager'
  };
  if (credential.account_id.trim()) {
    headers['Chatgpt-Account-Id'] = credential.account_id.trim();
  }

  const response = await transport.fetch({
    method: 'GET',
    path: CODEX_USAGE_PATH,
    headers
  });

  if (response.status < 200 || response.status >= 300) {
    return {
      status: 'error',
      planType: null,
      windows: [],
      error: `Codex quota request failed with HTTP ${response.status}`
    };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(response.body);
  } catch (e) {
    return {
      status: 'error',
      planType: null,
      windows: [],
      error: `Codex quota response is not JSON: ${(e as Error).message}`
    };
  }

  return buildCodexQuotaSnapshot(payload);
}

export function buildCodexQuotaSnapshot(payload: unknown): CodexQuotaSnapshot {
  const body = asObject(payload);
  if (!body) {
    return {
      status: 'unavailable',
      planType: null,
      windows: [],
      error: 'No quota payload'
    };
  }

  const rateLimit = asObject(body.rate_limit ?? body.rateLimit);
  const windows = [...buildCodexWindows(rateLimit), ...buildAdditionalCodexWindows(body)];

  return {
    status: windows.length ? 'success' : 'unavailable',
    planType: asString(body.plan_type ?? body.planType),
    windows,
    error: windows.length ? null : 'No quota windows'
  };
}

function buildAdditionalCodexWindows(payload: Record<string, unknown>): QuotaWindow[] {
  const items = Array.isArray(payload.additional_rate_limits)
    ? payload.additional_rate_limits
    : Array.isArray(payload.additionalRateLimits)
      ? payload.additionalRateLimits
      : [];

  return items.flatMap((item) => {
    const object = asObject(item);
    if (!object) return [];
    const limitName = asString(object.limit_name ?? object.limitName);
    const slug = slugify(limitName);
    const rateLimit = asObject(object.rate_limit ?? object.rateLimit);
    if (!limitName || !slug || !rateLimit) return [];
    return buildCodexWindows(rateLimit, limitName, `code-${slug}`);
  });
}

function buildCodexWindows(
  rateLimit: Record<string, unknown> | null,
  labelPrefix = '',
  idPrefix = 'code'
): QuotaWindow[] {
  const candidates = [
    asObject(rateLimit?.primary_window ?? rateLimit?.primaryWindow),
    asObject(rateLimit?.secondary_window ?? rateLimit?.secondaryWindow)
  ];

  return candidates
    .map((window, index) => {
      const classification = classifyCodexWindow(window, index);
      if (!classification) return null;
      const suffix = classification[0].replace(/^code-/, '');
      const label = labelPrefix ? `${labelPrefix} ${classification[1]}` : classification[1];
      return buildWindow(`${idPrefix}-${suffix}`, label, window);
    })
    .filter((window): window is QuotaWindow => Boolean(window));
}

function classifyCodexWindow(window: Record<string, unknown> | null, index: number): [string, string] | null {
  const seconds = asNumber(window?.limit_window_seconds ?? window?.limitWindowSeconds);
  if (seconds !== null) {
    if (seconds === FIVE_HOUR_SECONDS) return ['code-five-hour', '5 小时'];
    if (seconds === WEEK_SECONDS) return ['code-weekly', '7 天'];
    if (seconds >= MONTH_SECONDS_MIN && seconds <= MONTH_SECONDS_MAX) return ['code-monthly', '月度'];
    return [`code-window-${seconds}`, formatSecondsLabel(seconds)];
  }

  if (index === 0) return ['code-five-hour', '5 小时'];
  if (index === 1) return ['code-weekly', '7 天'];
  return null;
}

function buildWindow(id: string, label: string, window: Record<string, unknown> | null): QuotaWindow | null {
  if (!window) return null;
  return {
    id,
    label,
    usedPercent: asNumber(window.used_percent ?? window.usedPercent),
    resetAt: asResetAt(window.resets_at ?? window.resetsAt ?? window.reset_at ?? window.resetAt)
  };
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function slugify(value: string | null): string | null {
  if (!value) return null;
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || null;
}

function asResetAt(value: unknown): string | null {
  const text = asString(value);
  if (text) return text;
  const number = asNumber(value);
  if (number === null || number <= 0) return null;
  const milliseconds = number > 1_000_000_000_000 ? number : number * 1000;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatSecondsLabel(seconds: number): string {
  if (seconds % (24 * 60 * 60) === 0) return `${seconds / (24 * 60 * 60)} 天`;
  if (seconds % (60 * 60) === 0) return `${seconds / (60 * 60)} 小时`;
  return `${seconds} 秒`;
}
