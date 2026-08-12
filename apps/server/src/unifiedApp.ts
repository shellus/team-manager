import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Kysely } from 'kysely';
import type { AppConfig } from './config.js';
import type { Database } from './database/schema.js';
import { verifyJwt, signJwt } from './auth/jwt.js';
import { hashPassword, verifyPasswordHash } from './auth/password.js';
import { ArtifactStore } from './artifactStore.js';
import { SecretCipher } from './secretCipher.js';
import { AccountOperationalRepository } from './repositories/accountOperationalRepository.js';
import { SessionRepository } from './repositories/sessionRepository.js';
import { UnifiedProjectionRepository } from './repositories/unifiedProjectionRepository.js';
import { UnifiedAccountService } from './services/unifiedAccountService.js';
import { WorkspaceService } from './services/workspaceService.js';
import { WorkspaceOperationService } from './services/workspaceOperationService.js';
import { ServiceError } from './serviceError.js';
import type { AccountListFilters } from './repositories/accountRepository.js';
import { createTransport, type Transport } from './transport.js';
import { isEditableMemberRole } from '@team-manager/shared';

export interface UnifiedAppDeps {
  config: AppConfig;
  database: Kysely<Database>;
  artifactStore?: ArtifactStore;
  transport?: Transport;
}

export async function buildUnifiedApp({ config, database, transport = createTransport() }: UnifiedAppDeps): Promise<Hono> {
  const app = new Hono();
  const cipher = new SecretCipher(config.dataEncryptionKey, config.dataEncryptionKeyVersion);
  const sessions = new SessionRepository(database, cipher);
  const projections = new UnifiedProjectionRepository(database, sessions);
  const accounts = new UnifiedAccountService(
    database, projections, sessions, new AccountOperationalRepository(database, cipher)
  );
  const workspaces = new WorkspaceService(database, projections);
  const workspaceOperations = new WorkspaceOperationService(
    database, workspaces, sessions, new AccountOperationalRepository(database, cipher), transport
  );
  let adminHash = config.adminPasswordHash;
  if (!adminHash && config.adminPassword) adminHash = await hashPassword(config.adminPassword);

  if (config.allowedOrigins.length > 0) {
    app.use('*', cors({
      origin: (origin) => config.allowedOrigins.includes(origin) ? origin : config.allowedOrigins[0]!,
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'], credentials: true
    }));
  }
  app.get('/health', (c) => c.json({ ok: true, mode: 'unified-account-postgresql' }));
  app.post('/api/auth/login', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { username?: string; password?: string };
    if (!body.username || !body.password) return c.json({ ok: false, error: '缺少用户名或密码' }, 400);
    if (body.username !== config.adminUsername || !adminHash || !(await verifyPasswordHash(body.password, adminHash))) {
      return c.json({ ok: false, error: '用户名或密码错误' }, 401);
    }
    return c.json({ ok: true, data: { token: signJwt({
      subject: body.username, issuer: config.jwtIssuer, tokenType: 'access', secret: config.jwtSecret
    }) } });
  });

  const api = new Hono();
  api.use('*', async (c, next) => {
    const raw = c.req.header('Authorization') ?? '';
    const token = raw.startsWith('Bearer ') ? raw.slice(7) : '';
    if (token && config.apiToken && safeEqual(token, config.apiToken)) return next();
    const payload = token ? verifyJwt({ token, issuer: config.jwtIssuer, tokenType: 'access', secret: config.jwtSecret }) : null;
    if (!payload) return c.json({ ok: false, error: '未授权' }, 401);
    return next();
  });
  const wrap = async (c: any, fn: () => Promise<unknown>) => {
    try { return c.json({ ok: true, data: await fn() }); }
    catch (error) {
      const status = error instanceof ServiceError ? error.status : 500;
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, status as any);
    }
  };

  api.get('/account-groups', (c) => wrap(c, () => accounts.groups()));
  api.post('/account-groups', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { name?: string };
    if (!body.name?.trim()) return c.json({ ok: false, error: '缺少分组名称' }, 400);
    return wrap(c, () => accounts.createGroup(body.name!));
  });
  api.patch('/account-groups/:id', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { name?: string };
    if (!body.name?.trim()) return c.json({ ok: false, error: '缺少分组名称' }, 400);
    return wrap(c, () => accounts.renameGroup(c.req.param('id'), body.name!));
  });
  api.delete('/account-groups/:id', (c) => wrap(c, () => accounts.deleteGroup(c.req.param('id'))));

  api.get('/accounts', (c) => wrap(c, () => accounts.list(accountFilters(c))));
  api.post('/accounts', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    return wrap(c, () => accounts.create(body));
  });
  api.get('/accounts/:id', (c) => wrap(c, () => accounts.detail(c.req.param('id'))));
  api.patch('/accounts/:id', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    return wrap(c, () => accounts.update(c.req.param('id'), body));
  });
  api.delete('/accounts/:id', (c) => wrap(c, () => accounts.remove(c.req.param('id'))));

  api.get('/workspaces', (c) => wrap(c, () => workspaces.list(c.req.query('query'))));
  api.get('/workspaces/:id', (c) => wrap(c, () => workspaces.detail(c.req.param('id'))));
  api.post('/workspaces/:id/refresh', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { executorAccountId?: string };
    if (!body.executorAccountId) return c.json({ ok: false, error: '缺少 executorAccountId' }, 400);
    return wrap(c, async () => {
      await workspaceOperations.refreshMembers(c.req.param('id'), body.executorAccountId!);
      await workspaceOperations.refreshInvitations(c.req.param('id'), body.executorAccountId!);
      await workspaceOperations.refreshSettings(c.req.param('id'), body.executorAccountId!);
      return workspaceOperations.refreshBilling(c.req.param('id'), body.executorAccountId!);
    });
  });
  api.patch('/workspaces/:id', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { executorAccountId?: string; name?: string };
    if (!body.executorAccountId || !body.name?.trim()) return c.json({ ok: false, error: '缺少 executorAccountId 或 name' }, 400);
    return wrap(c, () => workspaceOperations.rename(c.req.param('id'), body.executorAccountId!, body.name!));
  });
  api.post('/workspaces/:id/members/refresh', async (c) => withExecutor(c, (accountId) => workspaceOperations.refreshMembers(c.req.param('id'), accountId)));
  api.post('/workspaces/:id/invitations/refresh', async (c) => withExecutor(c, (accountId) => workspaceOperations.refreshInvitations(c.req.param('id'), accountId)));
  api.post('/workspaces/:id/invitations', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { executorAccountId?: string; email?: string; seat?: 'default' | 'usage_based'; role?: string };
    if (!body.executorAccountId || !body.email || !body.seat) return c.json({ ok: false, error: '缺少 executorAccountId、email 或 seat' }, 400);
    return wrap(c, () => workspaceOperations.invite(c.req.param('id'), body.executorAccountId!, { email: body.email!, seat: body.seat!, role: body.role }));
  });
  api.delete('/workspaces/:id/invitations', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { executorAccountId?: string; email?: string };
    if (!body.executorAccountId || !body.email) return c.json({ ok: false, error: '缺少 executorAccountId 或 email' }, 400);
    return wrap(c, () => workspaceOperations.revokeInvitation(c.req.param('id'), body.executorAccountId!, body.email!));
  });
  api.delete('/workspaces/:id/members/:remoteUserId', async (c) => withExecutor(c, (accountId) => workspaceOperations.removeMember(c.req.param('id'), accountId, c.req.param('remoteUserId'))));
  api.patch('/workspaces/:id/members/:remoteUserId', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { executorAccountId?: string; seat?: 'default' | 'usage_based'; role?: unknown };
    if (!body.executorAccountId) return c.json({ ok: false, error: '缺少 executorAccountId' }, 400);
    if (body.seat) return wrap(c, () => workspaceOperations.setMemberSeat(c.req.param('id'), body.executorAccountId!, c.req.param('remoteUserId'), body.seat!));
    if (isEditableMemberRole(body.role)) {
      const role = body.role;
      return wrap(c, () => workspaceOperations.setMemberRole(c.req.param('id'), body.executorAccountId!, c.req.param('remoteUserId'), role));
    }
    return c.json({ ok: false, error: '缺少有效 seat 或 role' }, 400);
  });
  api.post('/workspaces/:id/settings/refresh', async (c) => withExecutor(c, (accountId) => workspaceOperations.refreshSettings(c.req.param('id'), accountId)));
  api.patch('/workspaces/:id/settings', async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const executor = typeof body.executorAccountId === 'string' ? body.executorAccountId : '';
    if (!executor) return c.json({ ok: false, error: '缺少 executorAccountId' }, 400);
    return wrap(c, () => workspaceOperations.patchSettings(c.req.param('id'), executor, body));
  });
  api.post('/workspaces/:id/billing/refresh', async (c) => withExecutor(c, (accountId) => workspaceOperations.refreshBilling(c.req.param('id'), accountId)));

  app.route('/api', api);
  return app;

  async function withExecutor(c: any, fn: (accountId: string) => Promise<unknown>) {
    const body = await c.req.json().catch(() => ({})) as { executorAccountId?: string };
    if (!body.executorAccountId) return c.json({ ok: false, error: '缺少 executorAccountId' }, 400);
    return wrap(c, () => fn(body.executorAccountId!));
  }
}

function accountFilters(c: any): AccountListFilters {
  return {
    ...(c.req.query('groupId') ? { groupId: c.req.query('groupId') } : {}),
    ...booleanQuery(c.req.query('hasManageableWorkspace'), 'hasManageableWorkspace'),
    ...booleanQuery(c.req.query('isWorkspaceMember'), 'isWorkspaceMember'),
    ...booleanQuery(c.req.query('hasWorkspaceCredential'), 'hasWorkspaceCredential'),
    ...booleanQuery(c.req.query('hasGamBinding'), 'hasGamBinding'),
    ...booleanQuery(c.req.query('hasSession'), 'hasSession'),
    ...booleanQuery(c.req.query('isBanned'), 'isBanned'),
    ...(c.req.query('personalPlan') ? { personalPlan: c.req.query('personalPlan') } : {}),
    ...(c.req.query('query') ? { query: c.req.query('query') } : {})
  };
}

function booleanQuery<K extends keyof AccountListFilters>(value: string | undefined, key: K): Partial<AccountListFilters> {
  return value === 'true' || value === '1' ? { [key]: true } : value === 'false' || value === '0' ? { [key]: false } : {};
}
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
