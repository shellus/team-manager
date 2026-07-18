import type { Browser, BrowserContext, Page } from 'playwright-core';
import { chromium } from 'playwright-core';
import { randomBytes } from 'node:crypto';
import type { SubaccountRegistrationEvent } from './subaccountRegistration.js';
import {
  createMihomoRegistrationProxyManager,
  type MihomoRegistrationProxyManager
} from './mihomoRegistrationProxy.js';

export interface CloakProfile {
  id: string;
  name: string;
  status?: string;
  vnc_ws_port?: number;
  cdp_url?: string;
  proxy?: string | null;
  proxySession?: string;
  [key: string]: unknown;
}

interface CloakBrowserConfig {
  baseUrl: string;
  token: string;
  proxy?: string;
  rotateUrl?: string;
  proxyManager?: MihomoRegistrationProxyManager;
}

type EventSink = (event: SubaccountRegistrationEvent) => void | Promise<void>;

export class CloakBrowserClient {
  constructor(
    readonly config: CloakBrowserConfig,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async createProfile(email: string, jobId: string, emit?: EventSink): Promise<CloakProfile> {
    const proxySession = randomBytes(6).toString('hex');
    const proxy = this.config.proxy?.replaceAll('{session}', proxySession) ?? null;
    await this.config.proxyManager?.ensureSession(proxySession, emit);
    try {
      const profile = await this.request('cloak_profile_create', '/api/profiles', {
        method: 'POST',
        body: {
          name: email,
          proxy,
          platform: 'windows',
          screen_width: 1920,
          screen_height: 1080,
          humanize: true,
          human_preset: 'careful',
          geoip: Boolean(this.config.proxy),
          notes: `Team Manager 自动注册\n邮箱: ${email}\n任务: ${jobId}`,
          tags: [
            { tag: 'team-manager', color: '#6366f1' },
            { tag: 'auto-registration', color: '#16a34a' }
          ]
        }
      }, emit, [], false, { proxySession, proxy }) as CloakProfile;
      return { ...profile, proxy: profile.proxy ?? proxy, proxySession };
    } catch (error) {
      await this.config.proxyManager?.releaseSession(proxySession, emit).catch(() => undefined);
      throw error;
    }
  }

  async getProfile(profileId: string, emit?: EventSink): Promise<CloakProfile> {
    const profile = await this.request(
      'cloak_profile_get',
      `/api/profiles/${encodeURIComponent(profileId)}`,
      {},
      emit
    ) as CloakProfile;
    const proxySession = extractProxySession(profile.proxy);
    if (proxySession) await this.config.proxyManager?.ensureSession(proxySession, emit);
    return { ...profile, ...(proxySession ? { proxySession } : {}) };
  }

  async launchProfile(profileId: string, emit?: EventSink): Promise<CloakProfile> {
    await this.request('cloak_profile_launch', `/api/profiles/${encodeURIComponent(profileId)}/launch`, {
      method: 'POST'
    }, emit, [409]);
    return this.getProfile(profileId, emit);
  }

  async stopProfile(profileId: string, emit?: EventSink): Promise<void> {
    await this.request('cloak_profile_stop', `/api/profiles/${encodeURIComponent(profileId)}/stop`, {
      method: 'POST'
    }, emit, [404, 409]);
  }

  async deleteProfile(profileId: string, emit?: EventSink, proxySession?: string): Promise<void> {
    await this.request('cloak_profile_delete', `/api/profiles/${encodeURIComponent(profileId)}`, {
      method: 'DELETE'
    }, emit, [404]);
    await this.config.proxyManager?.releaseSession(proxySession, emit);
  }

  async rotateProxy(attempt: number, email: string, emit?: EventSink): Promise<void> {
    if (!this.config.rotateUrl) {
      await emit?.({
        phase: this.config.proxy?.includes('{session}')
          ? 'cloak_proxy_rotation_via_session'
          : 'cloak_proxy_rotation_skipped',
        at: new Date().toISOString(),
        attempt,
        email,
        message: this.config.proxy?.includes('{session}')
          ? '重建 profile 时将生成新的代理 sid 和家宽出口'
          : '未配置 TEAMMGR_CLOAK_PROXY_ROTATE_URL；重建 profile 后继续使用当前单一出口'
      });
      return;
    }
    const url = this.config.rotateUrl;
    const body = { attempt, email };
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const text = await response.text();
    const event = {
      phase: 'cloak_proxy_rotate',
      at: new Date().toISOString(),
      request: { method: 'POST', url, headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body },
      response: {
        status: response.status,
        url: response.url,
        headers: Object.fromEntries(response.headers.entries()),
        body: text
      }
    } satisfies SubaccountRegistrationEvent;
    if (emit) await emit(event);
    else console.log(`[subaccount-registration] ${JSON.stringify(event)}`);
    if (!response.ok) throw new Error(`cloak_proxy_rotate_failed_${response.status}: ${text}`);
  }

  async connect(profileId: string): Promise<{
    browser: Browser;
    context: BrowserContext;
    page: Page;
  }> {
    const endpoint = `${this.config.baseUrl}/api/profiles/${encodeURIComponent(profileId)}/cdp`;
    const browser = await chromium.connectOverCDP(endpoint, {
      headers: { Authorization: `Bearer ${this.config.token}` },
      timeout: 60_000
    });
    const context = browser.contexts()[0];
    if (!context) {
      await browser.close();
      throw new Error('CloakBrowser CDP 未返回持久化浏览器上下文');
    }
    const page = context.pages()[0] ?? await context.newPage();
    return { browser, context, page };
  }

  private async request(
    phase: string,
    pathOrUrl: string,
    options: { method?: string; body?: unknown },
    emit?: EventSink,
    acceptedStatuses: number[] = [],
    absolute = false,
    extra: Record<string, unknown> = {}
  ): Promise<unknown> {
    const url = absolute ? pathOrUrl : `${this.config.baseUrl}${pathOrUrl}`;
    const headers = {
      Authorization: `Bearer ${this.config.token}`,
      Accept: 'application/json',
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' })
    };
    const response = await this.fetchImpl(url, {
      method: options.method ?? 'GET',
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
    });
    const text = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    const event = {
      phase,
      at: new Date().toISOString(),
      request: { method: options.method ?? 'GET', url, headers, body: options.body },
      response: {
        status: response.status,
        url: response.url,
        headers: Object.fromEntries(response.headers.entries()),
        body: text
      },
      ...extra
    } satisfies SubaccountRegistrationEvent;
    if (emit) await emit(event);
    else console.log(`[subaccount-registration] ${JSON.stringify(event)}`);
    if (!response.ok && !acceptedStatuses.includes(response.status)) {
      throw new Error(`${phase}_failed_${response.status}: ${text}`);
    }
    return data;
  }
}

export function createCloakBrowserClient(): CloakBrowserClient | undefined {
  const baseUrl = process.env.TEAMMGR_CLOAK_BROWSER_BASE_URL?.trim().replace(/\/+$/, '');
  const token = process.env.TEAMMGR_CLOAK_BROWSER_TOKEN?.trim();
  if (!baseUrl || !token) return undefined;
  const proxyManager = createMihomoRegistrationProxyManager();
  if (proxyManager) {
    void proxyManager.syncConfig().catch((error) => {
      console.error(`[team-manager] Mihomo 注册代理配置同步失败: ${(error as Error).message}`);
    });
  }
  return new CloakBrowserClient({
    baseUrl,
    token,
    proxy: process.env.TEAMMGR_CLOAK_PROXY?.trim() || undefined,
    rotateUrl: process.env.TEAMMGR_CLOAK_PROXY_ROTATE_URL?.trim() || undefined,
    proxyManager
  });
}

function extractProxySession(proxy: string | null | undefined): string | undefined {
  if (!proxy) return undefined;
  try {
    const username = decodeURIComponent(new URL(proxy).username);
    return /^[A-Za-z0-9_-]{1,64}$/.test(username) ? username : undefined;
  } catch {
    return undefined;
  }
}
