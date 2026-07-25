import { resolve } from 'node:path';

function nonEmptyEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

export interface AppConfig {
  port: number;
  dataDir: string;
  jwtSecret: string;
  jwtIssuer: string;
  adminUsername: string;
  adminPassword?: string;       // 明文（首次启动用于初始化 hash），优先用 adminPasswordHash
  adminPasswordHash?: string;
  apiToken?: string;            // 固定 API Token：带此 token 的请求绕过 JWT 直接放行（供 CLI 等脚本调用）
  allowedOrigins: string[];
  webDistDir: string;
  teamCodeBaseUrl?: string;
  teamCodePasscode?: string;
}

export function loadConfig(): AppConfig {
  const dataDir = resolve(nonEmptyEnv('TEAMMGR_DATA_DIR') ?? './data');
  const jwtSecret = nonEmptyEnv('TEAMMGR_JWT_SECRET') ?? 'dev-insecure-secret-change-me';
  return {
    port: Number(nonEmptyEnv('PORT') ?? '3000'),
    dataDir,
    jwtSecret,
    jwtIssuer: 'team-manager',
    adminUsername: nonEmptyEnv('TEAMMGR_ADMIN_USER') ?? 'admin',
    adminPassword: nonEmptyEnv('TEAMMGR_ADMIN_PASSWORD'),
    adminPasswordHash: nonEmptyEnv('TEAMMGR_ADMIN_PASSWORD_HASH'),
    apiToken: nonEmptyEnv('TEAMMGR_API_TOKEN'),
    allowedOrigins: parseAllowedOrigins(nonEmptyEnv('TEAMMGR_ALLOWED_ORIGINS')),
    webDistDir: resolve(nonEmptyEnv('TEAMMGR_WEB_DIST_DIR') ?? '../web/dist'),
    teamCodeBaseUrl: nonEmptyEnv('TEAMMGR_TEAMCODE_BASE_URL'),
    teamCodePasscode: nonEmptyEnv('TEAMMGR_TEAMCODE_PASSCODE')
  };
}

export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
