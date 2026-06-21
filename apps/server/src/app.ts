import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync } from 'node:fs';
import { relative } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import type { AppConfig } from './config.js';
import { signJwt, verifyJwt } from './auth/jwt.js';
import { hashPassword, verifyPasswordHash } from './auth/password.js';
import { AccountStore } from './accountStore.js';
import { TeamService, ServiceError } from './teamService.js';
import { SubaccountService } from './subaccountService.js';
import { SubaccountStore } from './subaccountStore.js';
import { normalizeAccountInput } from './normalizeAccount.js';
import type { CodexAutoAuthExecutor } from './codexAutoAuth.js';
import type { Transport } from './transport.js';
import type { InviteRequest, SeatType } from '@team-manager/shared';

export interface BuildAppDeps {
  config: AppConfig;
  store: AccountStore;
  subaccountStore: SubaccountStore;
  subaccountCodexFetch?: typeof fetch;
  subaccountQuotaTransport?: Transport;
  subaccountCodexAutoAuth?: CodexAutoAuthExecutor;
  teamTransport?: Transport;
}

// 恒定时间字符串比较，避免 token 校验的时序侧信道
function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function buildApp({
  config,
  store,
  subaccountStore,
  subaccountCodexFetch,
  subaccountQuotaTransport,
  subaccountCodexAutoAuth,
  teamTransport
}: BuildAppDeps): Promise<Hono> {
  const app = new Hono();
  const service = new TeamService(store, teamTransport);
  const subaccountService = new SubaccountService(
    subaccountStore,
    subaccountCodexFetch,
    subaccountQuotaTransport,
    subaccountCodexAutoAuth
  );

  // 解析管理员口令 hash（明文则现场 hash）
  let adminHash = config.adminPasswordHash;
  if (!adminHash && config.adminPassword) {
    adminHash = await hashPassword(config.adminPassword);
  }

  if (config.allowedOrigins.length > 0) {
    app.use(
      '/api/*',
      cors({
        origin: config.allowedOrigins,
        allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
        allowHeaders: ['Authorization', 'Content-Type'],
        credentials: true
      })
    );
  }

  app.get('/health', (c) => c.json({ ok: true }));

  // ---- 登录 ----
  app.post('/api/auth/login', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { username, password } = body as { username?: string; password?: string };
    if (!username || !password) return c.json({ ok: false, error: '缺少用户名或密码' }, 400);
    if (username !== config.adminUsername || !adminHash || !(await verifyPasswordHash(password, adminHash))) {
      return c.json({ ok: false, error: '用户名或密码错误' }, 401);
    }
    const token = signJwt({
      subject: username,
      issuer: config.jwtIssuer,
      tokenType: 'access',
      ttl: '12h',
      secret: config.jwtSecret
    });
    return c.json({ ok: true, data: { token } });
  });

  // ---- 鉴权中间件 ----
  const requireAuth = async (c: any, next: any) => {
    const header = c.req.header('Authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    // 固定 API Token 短路：仅当 token 非空、已配置 apiToken、且恒定时间比较相等时放行
    if (token && config.apiToken && timingSafeEqualStr(token, config.apiToken)) {
      await next();
      return;
    }
    const payload = token
      ? verifyJwt({ token, issuer: config.jwtIssuer, tokenType: 'access', secret: config.jwtSecret })
      : null;
    if (!payload) return c.json({ ok: false, error: '未授权' }, 401);
    await next();
  };

  const api = new Hono();
  api.use('*', requireAuth);

  const wrap = async (c: any, fn: () => Promise<unknown>) => {
    try {
      const data = await fn();
      return c.json({ ok: true, data });
    } catch (e) {
      if (e instanceof ServiceError) return c.json({ ok: false, error: e.message }, e.status as any);
      return c.json({ ok: false, error: (e as Error).message }, 500);
    }
  };

  // ---- 母号 ----
  api.get('/accounts', (c) => wrap(c, () => service.listAccounts()));

  api.post('/accounts', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const norm = normalizeAccountInput(body);
    if ('error' in norm) {
      return c.json({ ok: false, error: norm.error }, 400);
    }
    return wrap(c, () => service.addAccount(norm));
  });

  api.delete('/accounts/:id', (c) => wrap(c, () => service.removeAccount(c.req.param('id'))));

  api.patch('/accounts/:id/local-profile', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { label?: unknown; session?: unknown };
    return wrap(c, () => service.updateLocalProfile(c.req.param('id'), body));
  });

  api.post('/accounts/:id/refresh', (c) => wrap(c, () => service.refreshAccount(c.req.param('id'))));

  // ---- 成员 ----
  api.get('/accounts/:id/members', (c) => wrap(c, () => service.listCachedMembers(c.req.param('id'))));

  api.post('/accounts/:id/members/refresh', (c) => wrap(c, () => service.refreshMembers(c.req.param('id'))));

  api.post('/accounts/:id/invites', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Partial<InviteRequest>;
    if (!body.email || !body.seat) return c.json({ ok: false, error: '缺少 email 或 seat' }, 400);
    return wrap(c, () =>
      service.invite(c.req.param('id'), {
        email: body.email!,
        seat: body.seat!,
        role: body.role,
        confirmBillingRisk: body.confirmBillingRisk
      })
    );
  });

  api.get('/accounts/:id/invites', (c) => wrap(c, () => service.listCachedPendingInvites(c.req.param('id'))));

  api.post('/accounts/:id/invites/refresh', (c) =>
    wrap(c, () => service.refreshPendingInvites(c.req.param('id')))
  );

  api.get('/accounts/:id/invites/count', (c) => wrap(c, () => service.countCachedPendingInvites(c.req.param('id'))));

  api.post('/accounts/:id/invites/count/refresh', (c) =>
    wrap(c, () => service.countPendingInvites(c.req.param('id')))
  );

  api.delete('/accounts/:id/invites', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { email?: string };
    if (!body.email?.trim()) return c.json({ ok: false, error: '缺少 email' }, 400);
    return wrap(c, () => service.revokePendingInvite(c.req.param('id'), body.email!));
  });

  api.delete('/accounts/:id/members/:userId', (c) =>
    wrap(c, () => service.removeMember(c.req.param('id'), c.req.param('userId')))
  );

  api.patch('/accounts/:id/members/:userId', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      seat?: SeatType;
      confirmBillingRisk?: boolean;
    };
    if (!body.seat) return c.json({ ok: false, error: '缺少 seat' }, 400);
    return wrap(c, () =>
      service.setMemberSeat(c.req.param('id'), c.req.param('userId'), body.seat!, body.confirmBillingRisk)
    );
  });

  // ---- 设置（默认席位、Codex 邀请） ----
  api.get('/accounts/:id/settings', (c) => wrap(c, () => service.getCachedSettings(c.req.param('id'))));

  api.post('/accounts/:id/settings/refresh', (c) => wrap(c, () => service.refreshSettings(c.req.param('id'))));

  api.patch('/accounts/:id/settings', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      defaultSeat?: SeatType;
      workspaceReferralsEnabled?: boolean;
      personalAccessTokensEnabled?: boolean;
    };
    if (body.defaultSeat) return wrap(c, () => service.setDefaultSeat(c.req.param('id'), body.defaultSeat!));
    if (typeof body.workspaceReferralsEnabled === 'boolean') {
      return wrap(c, () =>
        service.setWorkspaceReferralsEnabled(c.req.param('id'), body.workspaceReferralsEnabled!)
      );
    }
    if (typeof body.personalAccessTokensEnabled === 'boolean') {
      return wrap(c, () =>
        service.setPersonalAccessTokensEnabled(c.req.param('id'), body.personalAccessTokensEnabled!)
      );
    }
    return c.json({ ok: false, error: '缺少 defaultSeat、workspaceReferralsEnabled 或 personalAccessTokensEnabled' }, 400);
  });

  api.patch('/accounts/:id/name', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { name?: string };
    if (!body.name?.trim()) return c.json({ ok: false, error: '缺少 Team 名称' }, 400);
    return wrap(c, () => service.renameTeam(c.req.param('id'), body.name!));
  });

  // ---- 子号池 ----
  api.get('/subaccounts', (c) => wrap(c, () => Promise.resolve(subaccountService.list())));

  api.post('/subaccounts/session', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    return wrap(c, () => subaccountService.importSession(body));
  });

  api.post('/subaccounts/codex-credential', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    return wrap(c, () => subaccountService.importCodexCredential(body));
  });

  api.patch('/subaccounts/:id/local-profile', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { label?: unknown; session?: unknown };
    return wrap(c, () => subaccountService.updateLocalProfile(c.req.param('id'), body));
  });

  api.get('/subaccounts/logs', (c) => wrap(c, () => Promise.resolve(subaccountService.listLogs())));

  api.delete('/subaccounts/:id', (c) => wrap(c, () => subaccountService.remove(c.req.param('id'))));

  api.post('/subaccounts/:id/codex-auth/start', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { chatgptAccountId?: string };
    return wrap(c, () => subaccountService.startCodexAuth(c.req.param('id'), body.chatgptAccountId));
  });

  api.get('/subaccounts/codex-auth/status', (c) =>
    wrap(c, () => subaccountService.getCodexAuthRuntimeStatus())
  );

  api.post('/subaccounts/:id/codex-auth/auto', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { chatgptAccountId?: string };
    return wrap(c, () => subaccountService.autoCompleteCodexAuth(c.req.param('id'), body.chatgptAccountId));
  });

  api.post('/subaccounts/:id/codex-auth/callback', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { sessionId?: string; callbackUrl?: string };
    if (!body.sessionId?.trim() || !body.callbackUrl?.trim()) {
      return c.json({ ok: false, error: '缺少 sessionId 或 callbackUrl' }, 400);
    }
    return wrap(c, () =>
      subaccountService.completeCodexAuth(c.req.param('id'), body.sessionId!, body.callbackUrl!)
    );
  });

  api.get('/subaccounts/:id/codex-credential', (c) =>
    wrap(c, () =>
      Promise.resolve(subaccountService.getCodexCredential(c.req.param('id'), c.req.query('chatgptAccountId')))
    )
  );

  api.post('/subaccounts/:id/quota/refresh', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { chatgptAccountId?: string };
    return wrap(c, () => subaccountService.refreshQuota(c.req.param('id'), body.chatgptAccountId));
  });

  api.post('/subaccounts/:id/team-invites', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      accountId?: string;
      seat?: SeatType;
      confirmBillingRisk?: boolean;
    };
    if (!body.accountId?.trim() || !body.seat) return c.json({ ok: false, error: '缺少 accountId 或 seat' }, 400);
    const subaccount = subaccountStore.get(c.req.param('id'));
    if (!subaccount) return c.json({ ok: false, error: `子号不存在: ${c.req.param('id')}` }, 404);
    return wrap(c, async () => {
      await service.invite(body.accountId!, {
        email: subaccount.email,
        seat: body.seat!,
        confirmBillingRisk: body.confirmBillingRisk
      });
      return subaccountStore.saveTeamLink(c.req.param('id'), {
        accountId: body.accountId!,
        seat: body.seat!,
        status: 'invited'
      });
    });
  });

  api.post('/subaccounts/:id/team-links/sync', (c) =>
    wrap(c, async () => {
      const id = c.req.param('id');
      const subaccount = subaccountStore.get(id);
      if (!subaccount) throw new ServiceError(404, `子号不存在: ${id}`);

      const accounts = await service.listAccounts();
      const existingLinks = new Map((subaccount.teamLinks ?? []).map((link) => [link.accountId, link]));
      const errors: Array<{ accountId: string; message: string }> = [];
      let updated = subaccountStore.list().find((item) => item.id === id);
      let found = 0;
      let removed = 0;
      let unknown = 0;

      for (const account of accounts) {
        const existing = existingLinks.get(account.id);
        try {
          const relation = await service.findEmailRelation(account.id, subaccount.email);
          if (relation.status === 'member' || relation.status === 'invited') {
            updated = await subaccountStore.saveTeamLink(id, {
              accountId: account.id,
              seat: relation.seat ?? existing?.seat ?? 'usage_based',
              status: relation.status
            });
            found += 1;
          } else if (existing) {
            updated = await subaccountStore.saveTeamLink(id, {
              accountId: account.id,
              seat: existing.seat,
              status: 'removed'
            });
            removed += 1;
          }
        } catch (e) {
          errors.push({ accountId: account.id, message: (e as Error).message });
          if (existing) {
            updated = await subaccountStore.saveTeamLink(id, {
              accountId: account.id,
              seat: existing.seat,
              status: 'unknown'
            });
            unknown += 1;
          }
        }
      }

      await subaccountStore.appendLog(id, {
        phase: 'team_link_sync',
        status: errors.length ? 'partial' : 'success',
        message: `已同步 ${accounts.length} 个母号关联`,
        data: {
          accountCount: accounts.length,
          found,
          removed,
          unknown,
          errorCount: errors.length,
          errors
        }
      });

      return updated ?? subaccountStore.list().find((item) => item.id === id);
    })
  );

  api.get('/subaccounts/:id/logs', (c) =>
    wrap(c, () => Promise.resolve(subaccountService.listLogs(c.req.param('id'))))
  );

  app.route('/api', api);

  // ---- 静态前端（生产） ----
  if (existsSync(config.webDistDir)) {
    const root = relative(process.cwd(), config.webDistDir) || '.';
    app.use('/*', serveStatic({ root }));
    // SPA fallback
    app.get('/*', serveStatic({ path: `${root}/index.html` }));
  }

  return app;
}
