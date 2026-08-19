import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ensureHashedAdminPassword, loadRuntimeConfig, parseRuntimeConfig } from './config.js';
import { verifyPasswordHash } from './auth/password.js';

test('plain administrator password is atomically migrated once while comments and order survive', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'team-manager-config-'));
  const path = join(directory, 'config.yaml');
  await writeFile(path, validConfig('plain-password'), { mode: 0o600 });
  await Promise.all([
    ensureHashedAdminPassword(path),
    ensureHashedAdminPassword(path),
    ensureHashedAdminPassword(path),
  ]);
  const migrated = await readFile(path, 'utf8');
  assert.match(migrated, /# keep-admin-comment/);
  assert.ok(migrated.indexOf('username:') < migrated.indexOf('password:'));
  const runtime = await loadRuntimeConfig(path, 'development');
  assert.equal(await verifyPasswordHash('plain-password', runtime.app.adminPasswordHash), true);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test('strict YAML rejects duplicates, aliases, merge keys, unsafe and unknown fields', async () => {
  const hash = '$2b$12$012345678901234567890u0123456789012345678901234567890';
  const base = validConfig(hash);
  assert.throws(() => parseRuntimeConfig(`${base}\nunknown: true\n`, '/tmp/config.yaml', 'development'), /unknown 是未知字段/);
  assert.throws(() => parseRuntimeConfig(base.replace('port: 3000', 'port: 3000\n  port: 3001'), '/tmp/config.yaml', 'development'), /Map keys must be unique/);
  assert.throws(() => parseRuntimeConfig(base.replace('allowedOrigins: []', 'allowedOrigins: &origins []').replace('username: admin', 'username: admin\n  extra: *origins'), '/tmp/config.yaml', 'development'), /alias/);
  assert.throws(() => parseRuntimeConfig(base.replace('username: admin', '__proto__: unsafe\n  username: admin'), '/tmp/config.yaml', 'development'), /不安全字段名/);
});

test('invalid plaintext configuration is validated before password writeback', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'team-manager-invalid-config-'));
  const path = join(directory, 'config.yaml');
  const invalid = validConfig('do-not-rewrite').replace('allowedOrigins: []', 'allowedOrigins: []\n  typo: true');
  await writeFile(path, invalid, { mode: 0o600 });
  await assert.rejects(() => ensureHashedAdminPassword(path), /server.typo 是未知字段/);
  assert.match(await readFile(path, 'utf8'), /password: do-not-rewrite/);
});

test('relative paths and runtime profiles are resolved from the fixed config root', () => {
  const hash = '$2b$12$012345678901234567890u0123456789012345678901234567890';
  const development = parseRuntimeConfig(validConfig(hash), '/srv/team-manager/config.yaml', 'development');
  const compose = parseRuntimeConfig(validConfig(hash), '/app/config.yaml', 'compose');
  assert.equal(development.app.dataDir, '/srv/team-manager/data');
  assert.equal(development.app.webDistDir, '/srv/team-manager/source/apps/web/dist');
  assert.match(development.app.databaseUrl, /@127\.0\.0\.1:5433\//);
  assert.equal(compose.app.webDistDir, '/app/apps/web/dist');
  assert.match(compose.app.databaseUrl, /@postgres:5432\//);
});

function validConfig(password: string): string {
  return `version: 1
server:
  port: 3000
  dataDir: ./data
  artifactDir: ./data/artifacts
  webDistDirs:
    development: ./source/apps/web/dist
    compose: ./apps/web/dist
  dataEncryptionKey: "${'0'.repeat(64)}"
  dataEncryptionKeyVersion: v1
  jwtSecret: test-secret
  jwtIssuer: team-manager
  apiToken: null
  allowedOrigins: []
admin:
  # keep-admin-comment
  username: admin
  password: ${password}
database:
  name: team_manager
  username: team_manager
  password: database-secret
  hosts:
    development: { host: 127.0.0.1, port: 5433 }
    compose: { host: postgres, port: 5432 }
integrations:
  accountManager:
    token: null
    baseUrls: { development: null, compose: null }
  teamCode: { baseUrl: null, passcode: null }
  stripe: { publishableKeys: [], paymentUserAgent: null, walletConfigId: null }
  payment:
    httpProxyHosts: { development: null, compose: null }
    billingPostalCode: null
    billingRegion: null
transport:
  curlCffiUrls: { development: null, compose: null }
  upstreamTraceFile: null
deployment:
  postgres: { publishedPort: 5433 }
  worker:
    chatgptBaseUrl: https://chatgpt.com
    chatgptProxy: null
    impersonate: chrome110
    requestTimeoutSeconds: 60
    ports: { development: 3011, compose: 8080 }
  web: { devApiTarget: http://127.0.0.1:3000 }
`;
}
