import type { CodexCredentialJson, CodexQuotaSnapshot, QuotaWindow } from '@team-manager/shared';
import type { Transport } from './transport.js';

const FIVE_HOUR_SECONDS = 18_000;
const WEEK_SECONDS = 604_800;

export async function fetchCodexQuota(credential: CodexCredentialJson, transport: Transport, proxy?: string): Promise<CodexQuotaSnapshot> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${credential.access_token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'codex_cli_rs team-manager'
  };
  if (credential.account_id?.trim()) headers['Chatgpt-Account-Id'] = credential.account_id.trim();
  const response = await transport.fetch({ method: 'GET', path: '/backend-api/wham/usage', headers, proxy });
  if (response.status < 200 || response.status >= 300) return { status: 'error', planType: null, windows: [], error: `HTTP ${response.status}` };
  try { return quotaFromPayload(JSON.parse(response.body)); }
  catch { return { status: 'error', planType: null, windows: [], error: '额度响应不是 JSON' }; }
}

export function quotaFromPayload(payload: unknown): CodexQuotaSnapshot {
  const body = record(payload); const rate = record(body?.rate_limit ?? body?.rateLimit);
  const candidates = [record(rate?.primary_window ?? rate?.primaryWindow), record(rate?.secondary_window ?? rate?.secondaryWindow)];
  const windows = candidates.flatMap((window, index): QuotaWindow[] => {
    if (!window) return [];
    const seconds = number(window.limit_window_seconds ?? window.limitWindowSeconds);
    const label = seconds === FIVE_HOUR_SECONDS || (!seconds && index === 0) ? '5 小时' : seconds === WEEK_SECONDS || (!seconds && index === 1) ? '7 天' : seconds ? `${seconds} 秒` : `窗口 ${index + 1}`;
    return [{ id: `code-${seconds ?? index}`, label, usedPercent: number(window.used_percent ?? window.usedPercent), resetAt: resetAt(window.resets_at ?? window.resetsAt) }];
  });
  const plan = string(body?.plan_type ?? body?.planType);
  return { status: windows.length ? 'success' : 'unavailable', planType: plan, windows, error: windows.length ? null : '没有额度窗口' };
}

function record(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function number(value: unknown): number | null { const parsed = Number(value); return value !== null && value !== '' && Number.isFinite(parsed) ? parsed : null; }
function string(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function resetAt(value: unknown): string | null { const text = string(value); if (text) return text; const n = number(value); return n ? new Date(n > 1e12 ? n : n * 1000).toISOString() : null; }
