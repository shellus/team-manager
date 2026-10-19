import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { stringify } from 'yaml';
import type { ResidentialProxyConfig } from '@team-manager/shared';
import { fetchWithRawTrace } from './transport.js';

// 静态资源与 CDN 不需要账号住宅出口，统一走前置代理。
const STATIC_DOMAIN_SUFFIXES = [
  'oaistatic.com',
  'oaiusercontent.com',
  'cdn.openai.com',
  'openaiassets.blob.core.windows.net',
  'cdn.auth0.com',
  'intercomcdn.com',
  'cloudflareinsights.com',
  'gstatic.com',
  'googleapis.com',
  'googletagmanager.com',
  'googleadservices.com',
  'doubleclick.net',
  'connect.facebook.net',
  'analytics.tiktok.com',
  'segment.io',
  'sentry.io',
  'datadoghq.com',
  'browser-intake-datadoghq.com',
  'js.stripe.com',
  'stripecdn.com',
  'stripe-camo.global.ssl.fastly.net'
];
const RELOAD_ATTEMPTS = 20;
const RELOAD_RETRY_MS = 500;

export interface ResidentialProxyGatewayConfig {
  /** 住宅代理上游 socks5://user:password@host:port。 */
  upstreamProxy: string;
  /** 住宅连接经由的 HTTP 前置代理。 */
  normalProxy: string;
  stickyMinutes: number;
  /** Mihomo 容器内的监听端口。 */
  listenPort: number;
  /** Team Manager 与 curl_cffi worker 访问网关的地址，不含认证信息。 */
  gatewayUrl: string;
  gatewayPassword: string;
  /** Team Manager 写入生成配置的路径。 */
  configPath: string;
  /** 同一文件在 Mihomo 容器内的路径。 */
  controllerConfigPath: string;
  controllerUrl: string;
  controllerSecret: string;
}

export interface ResidentialProxyEntry {
  accountId: string;
  config: ResidentialProxyConfig;
}

/** Team Manager 自有的 Mihomo 网关：每个账号一个认证用户和一个住宅节点。 */
export class ResidentialProxyGateway {
  #queue: Promise<void> = Promise.resolve();

  constructor(
    readonly config: ResidentialProxyGatewayConfig,
    private readonly entries: () => Promise<ResidentialProxyEntry[]>,
    private readonly fetchImpl?: typeof fetch
  ) {
    parseProxyUrl(config.upstreamProxy, 'SOCKS5');
    parseProxyUrl(config.normalProxy, 'HTTP');
    parseProxyUrl(config.gatewayUrl, 'HTTP');
  }

  proxyUrl(accountId: string): string {
    const url = new URL(this.config.gatewayUrl);
    url.username = encodeURIComponent(gatewayUser(accountId));
    url.password = encodeURIComponent(this.config.gatewayPassword);
    return url.toString().replace(/\/$/, '');
  }

  /** 按数据库重建 Mihomo 配置并热加载；可同时断开指定账号的旧连接。 */
  sync(options: { closeAccountId?: string } = {}): Promise<void> {
    const next = this.#queue.then(() => this.#sync(options.closeAccountId));
    this.#queue = next.catch(() => undefined);
    return next;
  }

  async #sync(closeAccountId?: string): Promise<void> {
    const body = stringify(buildMihomoConfig(this.config, await this.entries()));
    await mkdir(dirname(this.config.configPath), { recursive: true, mode: 0o700 });
    const temp = `${this.config.configPath}.tmp`;
    await writeFile(temp, body, { encoding: 'utf8', mode: 0o600 });
    await rename(temp, this.config.configPath);
    await chmod(this.config.configPath, 0o600);
    await this.#reload();
    if (closeAccountId) await this.#closeConnections(gatewayUser(closeAccountId));
  }

  async #reload(): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= RELOAD_ATTEMPTS; attempt += 1) {
      try {
        const response = await this.#controller('PUT', '/configs?force=true', { path: this.config.controllerConfigPath });
        if (!response.ok) throw new Error(`Mihomo 配置热加载失败 ${response.status}: ${await response.text()}`);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < RELOAD_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, RELOAD_RETRY_MS));
      }
    }
    throw new Error(`住宅代理 Mihomo 配置已写入但控制端不可用：${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  async #closeConnections(user: string): Promise<void> {
    const response = await this.#controller('GET', '/connections');
    if (!response.ok) throw new Error(`读取 Mihomo 连接失败 ${response.status}: ${await response.text()}`);
    const data = await response.json() as { connections?: Array<{ id?: string; metadata?: { inboundUser?: string } }> };
    for (const connection of data.connections ?? []) {
      if (connection.metadata?.inboundUser !== user || !connection.id) continue;
      await this.#controller('DELETE', `/connections/${encodeURIComponent(connection.id)}`);
    }
  }

  #controller(method: string, path: string, body?: unknown): Promise<Response> {
    return fetchWithRawTrace('residential-proxy-controller', `${this.config.controllerUrl.replace(/\/+$/, '')}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.config.controllerSecret}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }, this.fetchImpl);
  }
}

export function buildMihomoConfig(config: ResidentialProxyGatewayConfig, entries: ResidentialProxyEntry[]): Record<string, unknown> {
  const normal = parseProxyUrl(config.normalProxy, 'HTTP');
  const upstream = parseProxyUrl(config.upstreamProxy, 'SOCKS5');
  const users = entries.map((entry) => gatewayUser(entry.accountId));
  return {
    'mixed-port': config.listenPort,
    'allow-lan': true,
    'bind-address': '*',
    mode: 'rule',
    'log-level': 'info',
    ipv6: false,
    'external-controller': '0.0.0.0:9090',
    secret: config.controllerSecret,
    // Mihomo 把空列表视为不认证；没有账号配置时用占位用户保持监听需要认证。
    authentication: (users.length ? users : ['disabled']).map((user) => `${user}:${config.gatewayPassword}`),
    proxies: [
      {
        name: 'NORMAL',
        type: normal.protocol === 'https:' ? 'https' : 'http',
        server: normal.hostname,
        port: Number(normal.port),
        ...(normal.username ? { username: decodeURIComponent(normal.username) } : {}),
        ...(normal.password ? { password: decodeURIComponent(normal.password) } : {})
      },
      ...entries.map((entry) => ({
        name: nodeName(entry.accountId),
        type: 'socks5',
        server: upstream.hostname,
        port: Number(upstream.port),
        username: residentialUsername(config, entry.config),
        password: decodeURIComponent(upstream.password),
        udp: false,
        'dialer-proxy': 'NORMAL'
      }))
    ],
    rules: [
      ...STATIC_DOMAIN_SUFFIXES.map((domain) => `DOMAIN-SUFFIX,${domain},NORMAL`),
      ...entries.map((entry) => `IN-USER,${gatewayUser(entry.accountId)},${nodeName(entry.accountId)}`),
      'MATCH,NORMAL'
    ]
  };
}

/** 上游用户名：`<user>-region-<CC>[-asn-<ASN>][-st-<州>][-city-<城市>]-sid-<SID>-t-<分钟>`。 */
export function residentialUsername(
  config: Pick<ResidentialProxyGatewayConfig, 'upstreamProxy' | 'stickyMinutes'>,
  residential: ResidentialProxyConfig
): string {
  const parts = [decodeURIComponent(new URL(config.upstreamProxy).username), 'region', residential.country];
  if (residential.asn) parts.push('asn', residential.asn);
  if (residential.state) parts.push('st', residential.state);
  if (residential.city) parts.push('city', residential.city);
  parts.push('sid', residential.sid, 't', String(config.stickyMinutes));
  return parts.join('-');
}

function gatewayUser(accountId: string): string { return accountId.trim().toLowerCase(); }
function nodeName(accountId: string): string { return `RES-${gatewayUser(accountId)}`; }

function parseProxyUrl(value: string, expected: 'HTTP' | 'SOCKS5'): URL {
  const url = new URL(value);
  const allowed = expected === 'HTTP' ? ['http:', 'https:'] : ['socks5:', 'socks5h:'];
  if (!allowed.includes(url.protocol) || !url.hostname || !url.port) throw new Error(`${expected} 代理地址无效`);
  if (expected === 'SOCKS5' && (!url.username || !url.password)) throw new Error('住宅 SOCKS5 上游缺少账号或密码');
  return url;
}
