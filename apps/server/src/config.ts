import { constants } from 'node:fs';
import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isAlias, isMap, parseDocument, type Document, type Node } from 'yaml';
import {
  assertPasswordFitsBcrypt,
  hashPassword,
  isBcryptLike,
  isSupportedBcryptHash,
} from './auth/password.js';

const MAX_CONFIG_BYTES = 1024 * 1024;
const LOCK_TIMEOUT_MS = 5_000;
const LOCK_STALE_MS = 30_000;
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export type RuntimeProfile = 'development' | 'compose';

export interface AppConfig {
  port: number;
  dataDir: string;
  artifactDir: string;
  databaseUrl: string;
  dataEncryptionKey: string;
  dataEncryptionKeyVersion: string;
  jwtSecret: string;
  jwtIssuer: string;
  adminUsername: string;
  adminPasswordHash: string;
  apiToken?: string;
  allowedOrigins: string[];
  webDistDir: string;
  accountManagerBaseUrl?: string;
  accountManagerToken?: string;
  teamCodeBaseUrl?: string;
  teamCodePasscode?: string;
  stripePublishableKeys?: string[];
  stripePaymentUserAgent?: string;
  stripeWalletConfigId?: string;
  paymentHttpProxyHost?: string;
  paymentBillingPostalCode?: string;
  paymentBillingRegion?: string;
  curlCffiUrl?: string;
  upstreamTraceFile?: string;
}

export interface RuntimeConfig {
  app: AppConfig;
  deployment: {
    postgres: { database: string; username: string; password: string; publishedPort: number };
    worker: {
      chatgptBaseUrl: string;
      chatgptProxy?: string;
      impersonate: string;
      requestTimeoutSeconds: number;
      port: number;
    };
    web: { devApiTarget: string };
  };
}

export async function loadConfig(configPath?: string, profile?: RuntimeProfile): Promise<AppConfig> {
  return (await loadRuntimeConfig(configPath, profile)).app;
}

export async function loadRuntimeConfig(configPath?: string, profile?: RuntimeProfile): Promise<RuntimeConfig> {
  const resolvedPath = resolveConfigPath(configPath);
  const selectedProfile = profile ?? profileFromArgs();
  await ensureHashedAdminPassword(resolvedPath);
  return parseRuntimeConfig(await readPrivateConfig(resolvedPath), resolvedPath, selectedProfile);
}

export function resolveConfigPath(configPath?: string): string {
  const fromArgs = argumentValue('--config');
  return resolve(configPath ?? fromArgs ?? 'config.yaml');
}

export function profileFromArgs(): RuntimeProfile {
  const value = argumentValue('--profile') ?? 'development';
  if (value !== 'development' && value !== 'compose') throw new Error(`未知运行配置 profile：${value}`);
  return value;
}

export async function ensureHashedAdminPassword(configPath: string): Promise<void> {
  const initial = parseSafeDocument(await readPrivateConfig(configPath), configPath).getIn(['admin', 'password']);
  if (typeof initial === 'string' && isSupportedBcryptHash(initial)) return;
  const lock = await acquireLock(`${configPath}.lock`);
  try {
    const raw = await readPrivateConfig(configPath);
    const document = parseSafeDocument(raw, configPath);
    const current = document.getIn(['admin', 'password']);
    if (typeof current !== 'string') throw new Error('配置 admin.password 必须是字符串');
    if (isSupportedBcryptHash(current)) return;
    if (isBcryptLike(current)) throw new Error('配置 admin.password 使用了不支持或损坏的 bcrypt 前缀');
    assertPasswordFitsBcrypt(current);
    parseRuntimeConfig(raw, configPath, 'development', true);
    parseRuntimeConfig(raw, configPath, 'compose', true);
    document.setIn(['admin', 'password'], await hashPassword(current));
    await atomicWriteConfig(configPath, document.toString({ lineWidth: 0 }));
  } finally {
    await lock.release();
  }
}

export function parseRuntimeConfig(raw: string, configPath: string, profile: RuntimeProfile, allowPlaintextAdmin = false): RuntimeConfig {
  const value = parseSafeDocument(raw, configPath).toJS({ maxAliasCount: 0 });
  const root = strictObject(value, 'config', ['version', 'server', 'admin', 'database', 'integrations', 'transport', 'deployment']);
  if (integer(root.version, 'version') !== 1) throw new Error('配置 version 只支持 1');
  const server = strictObject(root.server, 'server', ['port', 'dataDir', 'artifactDir', 'webDistDirs', 'dataEncryptionKey', 'dataEncryptionKeyVersion', 'jwtSecret', 'jwtIssuer', 'apiToken', 'allowedOrigins']);
  const admin = strictObject(root.admin, 'admin', ['username', 'password']);
  const database = strictObject(root.database, 'database', ['name', 'username', 'password', 'hosts']);
  const databaseHosts = profileValues(database.hosts, 'database.hosts');
  const webDistDirs = profileValues(server.webDistDirs, 'server.webDistDirs');
  const integrations = strictObject(root.integrations, 'integrations', ['accountManager', 'teamCode', 'stripe', 'payment']);
  const accountManager = strictObject(integrations.accountManager, 'integrations.accountManager', ['token', 'baseUrls']);
  const teamCode = strictObject(integrations.teamCode, 'integrations.teamCode', ['baseUrl', 'passcode']);
  const stripe = strictObject(integrations.stripe, 'integrations.stripe', ['publishableKeys', 'paymentUserAgent', 'walletConfigId']);
  const payment = strictObject(integrations.payment, 'integrations.payment', ['httpProxyHosts', 'billingPostalCode', 'billingRegion']);
  const transport = strictObject(root.transport, 'transport', ['curlCffiUrls', 'upstreamTraceFile']);
  const deployment = strictObject(root.deployment, 'deployment', ['postgres', 'worker', 'web']);
  const deployPostgres = strictObject(deployment.postgres, 'deployment.postgres', ['publishedPort']);
  const worker = strictObject(deployment.worker, 'deployment.worker', ['chatgptBaseUrl', 'chatgptProxy', 'impersonate', 'requestTimeoutSeconds', 'ports']);
  const web = strictObject(deployment.web, 'deployment.web', ['devApiTarget']);
  const configDir = dirname(resolve(configPath));
  const dbName = text(database.name, 'database.name');
  const dbUser = text(database.username, 'database.username');
  const dbPassword = text(database.password, 'database.password');
  const databaseHost = strictObject(databaseHosts[profile], `database.hosts.${profile}`, ['host', 'port']);
  const adminHash = text(admin.password, 'admin.password');
  if (!isSupportedBcryptHash(adminHash)) {
    if (!allowPlaintextAdmin || isBcryptLike(adminHash)) throw new Error('配置 admin.password 必须是有效 bcrypt hash');
    assertPasswordFitsBcrypt(adminHash);
  }
  const accountManagerUrls = profileValues(accountManager.baseUrls, 'integrations.accountManager.baseUrls');
  const paymentHosts = profileValues(payment.httpProxyHosts, 'integrations.payment.httpProxyHosts');
  const curlCffiUrls = profileValues(transport.curlCffiUrls, 'transport.curlCffiUrls');
  const workerPorts = profileValues(worker.ports, 'deployment.worker.ports');
  const dataDir = configPathValue(server.dataDir, 'server.dataDir', configDir);
  const apiToken = optionalText(server.apiToken);
  const accountManagerBaseUrl = optionalProfileText(accountManagerUrls[profile]);
  const accountManagerToken = optionalText(accountManager.token);
  const teamCodeBaseUrl = optionalText(teamCode.baseUrl);
  const teamCodePasscode = optionalText(teamCode.passcode);
  const stripePublishableKeys = optionalStringArray(stripe.publishableKeys, 'integrations.stripe.publishableKeys');
  const stripePaymentUserAgent = optionalText(stripe.paymentUserAgent);
  const stripeWalletConfigId = optionalText(stripe.walletConfigId);
  const paymentHttpProxyHost = optionalProfileText(paymentHosts[profile]);
  const paymentBillingPostalCode = optionalText(payment.billingPostalCode);
  const paymentBillingRegion = optionalText(payment.billingRegion);
  const curlCffiUrl = optionalProfileText(curlCffiUrls[profile]);
  const upstreamTraceFile = optionalPath(transport.upstreamTraceFile, configDir);
  const workerProxy = optionalText(worker.chatgptProxy);
  return {
    app: {
      port: port(server.port, 'server.port'),
      dataDir,
      artifactDir: configPathValue(server.artifactDir, 'server.artifactDir', configDir),
      databaseUrl: postgresUrl(dbUser, dbPassword, text(databaseHost.host, `database.hosts.${profile}.host`), port(databaseHost.port, `database.hosts.${profile}.port`), dbName),
      dataEncryptionKey: text(server.dataEncryptionKey, 'server.dataEncryptionKey'),
      dataEncryptionKeyVersion: text(server.dataEncryptionKeyVersion, 'server.dataEncryptionKeyVersion'),
      jwtSecret: text(server.jwtSecret, 'server.jwtSecret'),
      jwtIssuer: optionalText(server.jwtIssuer) ?? 'team-manager',
      adminUsername: text(admin.username, 'admin.username'),
      adminPasswordHash: adminHash,
      allowedOrigins: stringArray(server.allowedOrigins, 'server.allowedOrigins'),
      webDistDir: configPathValue(webDistDirs[profile], `server.webDistDirs.${profile}`, configDir),
      ...(apiToken ? { apiToken } : {}),
      ...(accountManagerBaseUrl ? { accountManagerBaseUrl } : {}),
      ...(accountManagerToken ? { accountManagerToken } : {}),
      ...(teamCodeBaseUrl ? { teamCodeBaseUrl } : {}),
      ...(teamCodePasscode ? { teamCodePasscode } : {}),
      ...(stripePublishableKeys ? { stripePublishableKeys } : {}),
      ...(stripePaymentUserAgent ? { stripePaymentUserAgent } : {}),
      ...(stripeWalletConfigId ? { stripeWalletConfigId } : {}),
      ...(paymentHttpProxyHost ? { paymentHttpProxyHost } : {}),
      ...(paymentBillingPostalCode ? { paymentBillingPostalCode } : {}),
      ...(paymentBillingRegion ? { paymentBillingRegion } : {}),
      ...(curlCffiUrl ? { curlCffiUrl } : {}),
      ...(upstreamTraceFile ? { upstreamTraceFile } : {}),
    },
    deployment: {
      postgres: {
        database: dbName,
        username: dbUser,
        password: dbPassword,
        publishedPort: port(deployPostgres.publishedPort, 'deployment.postgres.publishedPort'),
      },
      worker: {
        chatgptBaseUrl: optionalText(worker.chatgptBaseUrl) ?? 'https://chatgpt.com',
        impersonate: optionalText(worker.impersonate) ?? 'chrome110',
        requestTimeoutSeconds: positiveNumber(worker.requestTimeoutSeconds, 'deployment.worker.requestTimeoutSeconds'),
        port: port(workerPorts[profile], `deployment.worker.ports.${profile}`),
        ...(workerProxy ? { chatgptProxy: workerProxy } : {}),
      },
      web: { devApiTarget: text(web.devApiTarget, 'deployment.web.devApiTarget') },
    },
  };
}

function parseSafeDocument(raw: string, configPath: string): Document {
  const document = parseDocument(raw, { uniqueKeys: true, prettyErrors: true, version: '1.2' });
  if (document.errors.length) throw new Error(`配置 ${configPath} 解析失败：${document.errors.map((error) => error.message).join('; ')}`);
  assertSafeYamlNode(document.contents as Node | null, 'config');
  return document;
}

function assertSafeYamlNode(node: Node | null | undefined, path: string): void {
  if (!node) return;
  if (isAlias(node)) throw new Error(`配置 ${path} 禁止使用 YAML alias`);
  if (isMap(node)) {
    for (const pair of node.items) {
      const key = String((pair.key as { value?: unknown } | null)?.value ?? '');
      if (key === '<<') throw new Error(`配置 ${path} 禁止使用 YAML merge key`);
      if (UNSAFE_KEYS.has(key)) throw new Error(`配置 ${path}.${key} 使用了不安全字段名`);
      assertSafeYamlNode(pair.value as Node | null, `${path}.${key}`);
    }
    return;
  }
  const items = (node as { items?: Node[] }).items;
  if (items) items.forEach((item, index) => assertSafeYamlNode(item, `${path}[${index}]`));
}

async function readPrivateConfig(configPath: string): Promise<string> {
  const handle = await open(configPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error(`配置不是普通文件：${configPath}`);
    if (stat.size > MAX_CONFIG_BYTES) throw new Error(`配置超过 ${MAX_CONFIG_BYTES} 字节限制`);
    return await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
}

async function atomicWriteConfig(configPath: string, content: string): Promise<void> {
  const directory = dirname(configPath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `.${randomUUID()}.config.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, configPath);
    const directoryHandle = await open(directory, 'r');
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function acquireLock(lockPath: string): Promise<{ release(): Promise<void> }> {
  const token = randomUUID();
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (true) {
    try {
      const handle = await open(lockPath, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, token, createdAt: Date.now() }));
      await handle.sync();
      await handle.close();
      return {
        async release() {
          const current = await readFile(lockPath, 'utf8').then(JSON.parse).catch(() => undefined);
          if (current?.token === token) await unlink(lockPath).catch(() => undefined);
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (await clearStaleLock(lockPath)) continue;
      if (Date.now() >= deadline) throw new Error(`等待配置文件锁超时：${lockPath}`);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    }
  }
}

async function clearStaleLock(lockPath: string): Promise<boolean> {
  const value = await readFile(lockPath, 'utf8').then(JSON.parse).catch(() => undefined);
  if (!value || !Number.isInteger(value.pid) || typeof value.createdAt !== 'number') {
    const age = await stat(lockPath).then((entry) => Date.now() - entry.mtimeMs).catch(() => 0);
    if (age <= LOCK_STALE_MS) return false;
    await unlink(lockPath).catch(() => undefined);
    return true;
  }
  if (Date.now() - value.createdAt <= LOCK_STALE_MS || processExists(value.pid)) return false;
  await unlink(lockPath).catch(() => undefined);
  return true;
}

function processExists(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}

function strictObject(value: unknown, path: string, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`配置 ${path} 必须是对象`);
  const row = value as Record<string, unknown>;
  for (const key of Object.keys(row)) if (!allowed.includes(key)) throw new Error(`配置 ${path}.${key} 是未知字段`);
  return row;
}

function profileValues(value: unknown, path: string): Record<RuntimeProfile, unknown> {
  return strictObject(value, path, ['development', 'compose']) as unknown as Record<RuntimeProfile, unknown>;
}

function text(value: unknown, path: string): string {
  const normalized = optionalText(value);
  if (!normalized) throw new Error(`配置 ${path} 不能为空`);
  return normalized;
}

function optionalText(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error('配置值必须是字符串');
  return value.trim() || undefined;
}

function optionalProfileText(value: unknown): string | undefined {
  return value === null ? undefined : optionalText(value);
}

function integer(value: unknown, path: string): number {
  if (!Number.isInteger(value)) throw new Error(`配置 ${path} 必须是整数`);
  return value as number;
}

function port(value: unknown, path: string): number {
  const result = integer(value, path);
  if (result < 1 || result > 65535) throw new Error(`配置 ${path} 必须是有效端口`);
  return result;
}

function positiveNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`配置 ${path} 必须是正数`);
  return value;
}

function stringArray(value: unknown, path: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(`配置 ${path} 必须是字符串数组`);
  return value.map((item) => item.trim()).filter(Boolean);
}

function optionalStringArray(value: unknown, path: string): string[] | undefined {
  const result = stringArray(value, path);
  return result.length ? result : undefined;
}

function configPathValue(value: unknown, path: string, root: string): string {
  const configured = text(value, path);
  return resolve(root, configured);
}

function optionalPath(value: unknown, root: string): string | undefined {
  const configured = optionalText(value);
  return configured ? resolve(root, configured) : undefined;
}

function postgresUrl(username: string, password: string, host: string, databasePort: number, database: string): string {
  return `postgresql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${databasePort}/${encodeURIComponent(database)}`;
}

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} 缺少参数`);
  return value;
}
