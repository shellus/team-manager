import { fetchWithRawTrace } from './transport.js';

const DEFAULT_BASE_URL = 'https://api.frankfurter.dev';
const DEFAULT_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

export interface ExchangeRateQuote {
  base: string;
  quote: 'CNY';
  rate: number;
  date: string;
}

export interface ExchangeRateGateway {
  getCnyRate(currency: string): Promise<ExchangeRateQuote | undefined>;
}

interface CachedQuote {
  value: ExchangeRateQuote;
  cachedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** 使用 Frankfurter 的官方参考汇率源，并在进程内缓存每日汇率。 */
export class FrankfurterExchangeRateService implements ExchangeRateGateway {
  private readonly cache = new Map<string, CachedQuote>();
  private readonly pending = new Map<string, Promise<ExchangeRateQuote | undefined>>();

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly baseUrl = DEFAULT_BASE_URL,
    private readonly cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    private readonly now: () => number = Date.now
  ) {}

  async getCnyRate(currency: string): Promise<ExchangeRateQuote | undefined> {
    const normalized = currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(normalized)) return undefined;
    if (normalized === 'CNY') {
      return { base: 'CNY', quote: 'CNY', rate: 1, date: new Date(this.now()).toISOString().slice(0, 10) };
    }

    const cached = this.cache.get(normalized);
    if (cached && this.now() - cached.cachedAt < this.cacheTtlMs) return cached.value;
    const current = this.pending.get(normalized);
    if (current) return current;

    const request = this.fetchQuote(normalized, cached?.value)
      .finally(() => this.pending.delete(normalized));
    this.pending.set(normalized, request);
    return request;
  }

  private async fetchQuote(currency: string, stale?: ExchangeRateQuote): Promise<ExchangeRateQuote | undefined> {
    try {
      const response = await fetchWithRawTrace(
        'frankfurter-exchange-rate',
        `${this.baseUrl.replace(/\/$/, '')}/v2/rate/${currency}/CNY`,
        { headers: { Accept: 'application/json' } },
        this.fetchImpl
      );
      if (!response.ok) throw new Error(`Frankfurter HTTP ${response.status}`);
      const raw = await response.json() as unknown;
      if (!isRecord(raw)) throw new Error('Frankfurter 返回格式无效');
      const rate = raw.rate;
      const date = raw.date;
      if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0 || typeof date !== 'string' || !date) {
        throw new Error('Frankfurter 返回汇率无效');
      }
      const value: ExchangeRateQuote = { base: currency, quote: 'CNY', rate, date };
      this.cache.set(currency, { value, cachedAt: this.now() });
      return value;
    } catch {
      return stale;
    }
  }
}
