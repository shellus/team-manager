import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { open, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { stringify } from 'yaml';
import { loadRuntimeConfig, type RuntimeConfig, type RuntimeProfile } from './config.js';
import { isSupportedBcryptHash } from './auth/password.js';

async function main(): Promise<void> {
  const command = process.argv.slice(2).find((argument) => argument !== '--');
  if (command === 'exec') return executeWithConfig();
  if (command === 'migrate-env') return migrateEnv();
  throw new Error('Usage: config exec --config <path> --profile <development|compose> -- <command> [args...] | config migrate-env --from <path> --to <path>');
}

async function executeWithConfig(): Promise<void> {
  const separator = process.argv.lastIndexOf('--');
  if (separator < 0 || !process.argv[separator + 1]) throw new Error('config exec 缺少 -- 后的命令');
  const configPath = requiredArgument('--config');
  const profile = runtimeProfile(requiredArgument('--profile'));
  const runtime = await loadRuntimeConfig(configPath, profile);
  const child = spawn(process.argv[separator + 1]!, process.argv.slice(separator + 2), {
    stdio: 'inherit',
    env: { ...process.env, ...runtimeEnvironment(runtime) },
  });
  const signal = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', (code, exitSignal) => resolveExit({ code, signal: exitSignal }));
  });
  if (signal.signal) process.kill(process.pid, signal.signal);
  process.exitCode = signal.code ?? 1;
}

async function migrateEnv(): Promise<void> {
  const from = resolve(requiredArgument('--from'));
  const to = resolve(requiredArgument('--to'));
  const values = parseDotEnv(await readFile(from, 'utf8'));
  const document = migrationDocument(values, dirname(to));
  const handle = await open(to, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(`# Team Manager 私有运行配置。明文 admin.password 会在首次读取时原子转换为 bcrypt。\n${stringify(document, { lineWidth: 0 })}`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  console.log(`已生成配置：${to}`);
}

export function runtimeEnvironment(runtime: RuntimeConfig): NodeJS.ProcessEnv {
  const worker = runtime.deployment.worker;
  return compact({
    TEAMMGR_POSTGRES_DB: runtime.deployment.postgres.database,
    TEAMMGR_POSTGRES_USER: runtime.deployment.postgres.username,
    TEAMMGR_POSTGRES_PASSWORD: runtime.deployment.postgres.password,
    TEAMMGR_POSTGRES_PORT: String(runtime.deployment.postgres.publishedPort),
    TEAMMGR_CHATGPT_BASE_URL: worker.chatgptBaseUrl,
    TEAMMGR_CHATGPT_PROXY: worker.chatgptProxy,
    TEAMMGR_CURL_CFFI_IMPERSONATE: worker.impersonate,
    TEAMMGR_CURL_CFFI_TIMEOUT: String(worker.requestTimeoutSeconds),
    TEAMMGR_CURL_CFFI_PORT: String(worker.port),
    TEAMMGR_DEV_API_TARGET: runtime.deployment.web.devApiTarget,
  });
}

export function parseDotEnv(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  raw.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) throw new Error(`.env 第 ${index + 1} 行格式无效`);
    const [, key, encoded] = match;
    if (Object.hasOwn(result, key!)) throw new Error(`.env 存在重复字段 ${key}`);
    result[key!] = decodeDotEnvValue(encoded!);
  });
  return result;
}

function migrationDocument(env: Record<string, string>, configRoot: string): Record<string, unknown> {
  const databaseUrl = new URL(requiredEnv(env, 'TEAMMGR_DATABASE_URL'));
  const serverPort = positiveInteger(env.PORT ?? '3000', 'PORT');
  const postgresPort = positiveInteger(env.TEAMMGR_POSTGRES_PORT ?? databaseUrl.port ?? '5432', 'TEAMMGR_POSTGRES_PORT');
  return {
    version: 1,
    server: {
      port: serverPort,
      dataDir: migratePath(env.TEAMMGR_DATA_DIR ?? '../data', configRoot),
      artifactDir: migratePath(env.TEAMMGR_ARTIFACT_DIR ?? '../data/artifacts', configRoot),
      webDistDirs: { development: './source/apps/web/dist', compose: './apps/web/dist' },
      dataEncryptionKey: requiredEnv(env, 'TEAMMGR_DATA_ENCRYPTION_KEY'),
      dataEncryptionKeyVersion: env.TEAMMGR_DATA_ENCRYPTION_KEY_VERSION || 'v1',
      jwtSecret: env.TEAMMGR_JWT_SECRET || 'dev-insecure-secret-change-me',
      jwtIssuer: 'team-manager',
      apiToken: env.TEAMMGR_API_TOKEN || null,
      allowedOrigins: csv(env.TEAMMGR_ALLOWED_ORIGINS),
    },
    admin: {
      username: env.TEAMMGR_ADMIN_USER || 'admin',
      password: migrationAdminPassword(env),
    },
    database: {
      name: env.TEAMMGR_POSTGRES_DB || databaseUrl.pathname.replace(/^\//, ''),
      username: env.TEAMMGR_POSTGRES_USER || decodeURIComponent(databaseUrl.username),
      password: env.TEAMMGR_POSTGRES_PASSWORD || decodeURIComponent(databaseUrl.password),
      hosts: {
        development: { host: databaseUrl.hostname, port: positiveInteger(databaseUrl.port || String(postgresPort), 'TEAMMGR_DATABASE_URL port') },
        compose: { host: 'postgres', port: 5432 },
      },
    },
    integrations: {
      accountManager: {
        token: env.TEAMMGR_ACCOUNT_MANAGER_TOKEN || null,
        baseUrls: {
          development: env.TEAMMGR_ACCOUNT_MANAGER_BASE_URL || null,
          compose: 'http://registrar-api:3000',
        },
      },
      teamCode: {
        baseUrl: env.TEAMMGR_TEAMCODE_BASE_URL || null,
        passcode: env.TEAMMGR_TEAMCODE_PASSCODE || null,
      },
      stripe: {
        publishableKeys: csv(env.TEAMMGR_STRIPE_PUBLISHABLE_KEYS),
        paymentUserAgent: env.TEAMMGR_STRIPE_PAYMENT_USER_AGENT || null,
        walletConfigId: env.TEAMMGR_STRIPE_WALLET_CONFIG_ID || null,
      },
      payment: {
        httpProxyHosts: {
          development: env.TEAMMGR_PAYMENT_HTTP_PROXY_HOST || null,
          compose: 'host.docker.internal',
        },
        billingPostalCode: env.TEAMMGR_PAYMENT_BILLING_POSTAL_CODE || null,
        billingRegion: env.TEAMMGR_PAYMENT_BILLING_REGION || null,
      },
    },
    transport: {
      curlCffiUrls: {
        development: env.TEAMMGR_CURL_CFFI_URL || 'http://127.0.0.1:3011',
        compose: 'http://curl-cffi-worker:8080',
      },
      upstreamTraceFile: './data/upstream-http-trace.jsonl',
    },
    deployment: {
      postgres: { publishedPort: postgresPort },
      worker: {
        chatgptBaseUrl: env.TEAMMGR_CHATGPT_BASE_URL || 'https://chatgpt.com',
        chatgptProxy: env.TEAMMGR_CHATGPT_PROXY || null,
        impersonate: env.TEAMMGR_CURL_CFFI_IMPERSONATE || 'chrome110',
        requestTimeoutSeconds: Number(env.TEAMMGR_CURL_CFFI_TIMEOUT || '60'),
        ports: { development: 3011, compose: 8080 },
      },
      web: { devApiTarget: `http://127.0.0.1:${serverPort}` },
    },
  };
}

function migratePath(value: string, configRoot: string): string {
  const absolute = isAbsolute(value) ? resolve(value) : resolve(configRoot, 'source', value);
  const migrated = relative(configRoot, absolute).replaceAll('\\', '/');
  return migrated.startsWith('.') ? migrated : `./${migrated}`;
}

function decodeDotEnvValue(value: string): string {
  if (value.startsWith('"')) {
    try { return JSON.parse(value); }
    catch { throw new Error('.env 双引号值格式无效'); }
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'")) throw new Error('.env 单引号值格式无效');
    return value.slice(1, -1);
  }
  return value;
}

function requiredEnv(env: Record<string, string>, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`.env 缺少 ${key}`);
  return value;
}

function migrationAdminPassword(env: Record<string, string>): string {
  const plaintext = env.TEAMMGR_ADMIN_PASSWORD?.trim();
  if (plaintext) return plaintext;
  const stored = env.TEAMMGR_ADMIN_PASSWORD_HASH?.trim();
  if (stored && isSupportedBcryptHash(stored)) return stored;
  if (stored) throw new Error('旧管理员密码 hash 不是 bcrypt，必须提供 TEAMMGR_ADMIN_PASSWORD 才能迁移');
  throw new Error('.env 缺少 TEAMMGR_ADMIN_PASSWORD');
}

function requiredArgument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value === '--') throw new Error(`${name} 缺少参数`);
  return value;
}

function runtimeProfile(value: string): RuntimeProfile {
  if (value !== 'development' && value !== 'compose') throw new Error(`未知 profile：${value}`);
  return value;
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} 必须是正整数`);
  return parsed;
}

function csv(value?: string): string[] {
  return value?.split(',').map((item) => item.trim()).filter(Boolean) ?? [];
}

function compact(value: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
