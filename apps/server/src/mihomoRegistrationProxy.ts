import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { URL } from 'node:url';
import { stringify } from 'yaml';
import type { SubaccountRegistrationEvent } from './subaccountRegistration.js';

const SESSION_FILE = 'registration-mihomo-sessions.json';
const STATIC_DOMAIN_SUFFIXES = [
  'oaistatic.com',
  'oaiusercontent.com',
  'cdn.openai.com',
  'intercomcdn.com',
  'cloudflareinsights.com',
  'gstatic.com',
  'googleapis.com',
  'segment.io',
  'sentry.io',
  'datadoghq.com',
  'browser-intake-datadoghq.com'
];

type EventSink = (event: SubaccountRegistrationEvent) => void | Promise<void>;

interface MihomoRegistrationProxyConfig {
  configPath: string;
  controllerConfigPath: string;
  controllerUrl: string;
  controllerSecret: string;
  listenPort: number;
  gatewayPassword: string;
  normalProxy: string;
  residentialProxy: string;
  residentialRegion: string;
  residentialState?: string;
  residentialCity?: string;
  residentialTtlSeconds: number;
  dataDir: string;
}

interface PersistedSessions {
  sessions: Array<{ id: string; createdAt: number }>;
}

export class MihomoRegistrationProxyManager {
  private readonly sessionFile: string;
  private readonly sessions = new Map<string, number>();
  private initialized = false;
  private updateQueue: Promise<void> = Promise.resolve();

  constructor(
    readonly config: MihomoRegistrationProxyConfig,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    this.sessionFile = join(config.dataDir, SESSION_FILE);
  }

  async ensureSession(sessionId: string, emit?: EventSink): Promise<void> {
    validateSessionId(sessionId);
    await this.enqueue(async () => {
      await this.init();
      const created = !this.sessions.has(sessionId);
      if (created) {
        this.sessions.set(sessionId, Date.now());
        await this.persistSessions();
      }
      await this.writeConfig();
      await this.reloadConfig();
      await emit?.({
        phase: 'mihomo_registration_session_ready',
        sessionId,
        created,
        configPath: this.config.configPath,
        normalProxy: this.config.normalProxy,
        residentialProxy: this.config.residentialProxy,
        residentialUsername: buildResidentialUsername(this.config, sessionId),
        residentialPassword: decodeURIComponent(new URL(this.config.residentialProxy).password),
        staticDomainSuffixes: STATIC_DOMAIN_SUFFIXES,
        message: 'Mihomo 已为当前邮箱建立独立家宽会话；静态/CDN 域名走普通出口'
      });
    });
  }

  async releaseSession(sessionId: string | undefined, emit?: EventSink): Promise<void> {
    if (!sessionId) return;
    validateSessionId(sessionId);
    await this.enqueue(async () => {
      await this.init();
      if (!this.sessions.delete(sessionId)) return;
      await this.persistSessions();
      await this.writeConfig();
      await this.reloadConfig();
      await emit?.({
        phase: 'mihomo_registration_session_released',
        sessionId,
        message: '已删除失败 profile 对应的 Mihomo 家宽会话'
      });
    });
  }

  private async init(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.config.dataDir, { recursive: true });
    if (existsSync(this.sessionFile)) {
      const parsed = JSON.parse(await readFile(this.sessionFile, 'utf8')) as Partial<PersistedSessions>;
      for (const item of parsed.sessions ?? []) {
        if (item && typeof item.id === 'string' && typeof item.createdAt === 'number') {
          this.sessions.set(item.id, item.createdAt);
        }
      }
    }
    this.initialized = true;
  }

  private async persistSessions(): Promise<void> {
    const body = JSON.stringify({
      sessions: [...this.sessions.entries()].map(([id, createdAt]) => ({ id, createdAt }))
    } satisfies PersistedSessions, null, 2);
    const temp = `${this.sessionFile}.tmp`;
    await writeFile(temp, body, 'utf8');
    await rename(temp, this.sessionFile);
  }

  private async writeConfig(): Promise<void> {
    await mkdir(dirname(this.config.configPath), { recursive: true });
    const body = stringify(buildMihomoConfig(this.config, [...this.sessions.keys()]));
    const temp = `${this.config.configPath}.tmp`;
    await writeFile(temp, body, 'utf8');
    await rename(temp, this.config.configPath);
  }

  private async reloadConfig(): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      try {
        const response = await this.fetchImpl(`${this.config.controllerUrl}/configs?force=true`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${this.config.controllerSecret}`,
            Accept: 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ path: this.config.controllerConfigPath })
        });
        const text = await response.text();
        if (!response.ok) throw new Error(`mihomo_reload_failed_${response.status}: ${text}`);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < 20) await delay(500);
      }
    }
    throw new Error(`Mihomo 配置已写入但控制端连续 10 秒不可用: ${serializeError(lastError)}`);
  }

  private async enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.updateQueue.then(operation, operation);
    this.updateQueue = next.catch(() => undefined);
    await next;
  }
}

export function buildMihomoConfig(config: MihomoRegistrationProxyConfig, sessionIds: string[]): Record<string, unknown> {
  const normal = parseProxyUrl(config.normalProxy, 'HTTP');
  const residential = parseProxyUrl(config.residentialProxy, 'SOCKS5');
  const proxies: Array<Record<string, unknown>> = [
    {
      name: 'NORMAL',
      type: normal.protocol === 'https:' ? 'https' : 'http',
      server: normal.hostname,
      port: parsePort(normal),
      ...(normal.username ? { username: decodeURIComponent(normal.username) } : {}),
      ...(normal.password ? { password: decodeURIComponent(normal.password) } : {})
    }
  ];
  for (const sessionId of sessionIds) {
    proxies.push({
      name: proxyName(sessionId),
      type: 'socks5',
      server: residential.hostname,
      port: parsePort(residential),
      username: buildResidentialUsername(config, sessionId),
      password: decodeURIComponent(residential.password),
      udp: false,
      'dialer-proxy': 'NORMAL'
    });
  }
  return {
    'mixed-port': config.listenPort,
    'allow-lan': true,
    'bind-address': '*',
    mode: 'rule',
    'log-level': 'info',
    ipv6: false,
    'external-controller': '0.0.0.0:9090',
    secret: config.controllerSecret,
    authentication: sessionIds.length
      ? sessionIds.map((id) => `${id}:${config.gatewayPassword}`)
      : [`disabled:${config.gatewayPassword}`],
    proxies,
    rules: [
      ...STATIC_DOMAIN_SUFFIXES.map((domain) => `DOMAIN-SUFFIX,${domain},NORMAL`),
      ...sessionIds.map((id) => `IN-USER,${id},${proxyName(id)}`),
      'MATCH,NORMAL'
    ]
  };
}

export function buildResidentialUsername(
  config: Pick<
    MihomoRegistrationProxyConfig,
    'residentialProxy' | 'residentialRegion' | 'residentialState' | 'residentialCity' | 'residentialTtlSeconds'
  >,
  sessionId: string
): string {
  const account = decodeURIComponent(new URL(config.residentialProxy).username);
  const parts = [account, 'region', config.residentialRegion];
  if (config.residentialState) parts.push('st', config.residentialState);
  if (config.residentialCity) parts.push('city', config.residentialCity);
  parts.push('sid', sessionId, 't', String(config.residentialTtlSeconds));
  return parts.join('-');
}

export function createMihomoRegistrationProxyManager(): MihomoRegistrationProxyManager | undefined {
  const configPath = process.env.TEAMMGR_MIHOMO_CONFIG_PATH?.trim();
  const controllerConfigPath = process.env.TEAMMGR_MIHOMO_CONTROLLER_CONFIG_PATH?.trim();
  const controllerUrl = process.env.TEAMMGR_MIHOMO_CONTROLLER_URL?.trim().replace(/\/+$/, '');
  const controllerSecret = process.env.TEAMMGR_MIHOMO_CONTROLLER_SECRET?.trim();
  const gatewayPassword = process.env.TEAMMGR_MIHOMO_GATEWAY_PASSWORD?.trim();
  const normalProxy = process.env.TEAMMGR_MIHOMO_NORMAL_PROXY?.trim();
  const residentialProxy = process.env.TEAMMGR_MIHOMO_RESIDENTIAL_PROXY?.trim();
  const residentialRegion = process.env.TEAMMGR_MIHOMO_RESIDENTIAL_REGION?.trim();
  if (
    !configPath || !controllerConfigPath || !controllerUrl || !controllerSecret || !gatewayPassword
    || !normalProxy || !residentialProxy || !residentialRegion
  ) return undefined;
  return new MihomoRegistrationProxyManager({
    configPath,
    controllerConfigPath,
    controllerUrl,
    controllerSecret,
    listenPort: positiveInteger(process.env.TEAMMGR_MIHOMO_LISTEN_PORT, 3012),
    gatewayPassword,
    normalProxy,
    residentialProxy,
    residentialRegion,
    residentialState: process.env.TEAMMGR_MIHOMO_RESIDENTIAL_STATE?.trim() || undefined,
    residentialCity: process.env.TEAMMGR_MIHOMO_RESIDENTIAL_CITY?.trim() || undefined,
    residentialTtlSeconds: positiveInteger(process.env.TEAMMGR_MIHOMO_RESIDENTIAL_TTL_SECONDS, 120),
    dataDir: process.env.TEAMMGR_DATA_DIR?.trim() || './data'
  });
}

function parseProxyUrl(value: string, expected: 'HTTP' | 'SOCKS5'): URL {
  const url = new URL(value);
  const allowed = expected === 'HTTP' ? ['http:', 'https:'] : ['socks5:', 'socks5h:'];
  if (!allowed.includes(url.protocol) || !url.hostname || !url.port) {
    throw new Error(`${expected} 代理地址无效: ${value}`);
  }
  if (expected === 'SOCKS5' && (!url.username || !url.password)) {
    throw new Error(`家宽 SOCKS5 代理缺少账号或密码: ${value}`);
  }
  return url;
}

function parsePort(url: URL): number {
  const port = Number(url.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`代理端口无效: ${url.toString()}`);
  return port;
}

function proxyName(sessionId: string): string {
  return `RES-${sessionId}`;
}

function validateSessionId(value: string): void {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw new Error(`Mihomo session id 无效: ${value}`);
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function serializeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
