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
import { AccountBillingStore } from './accountBillingStore.js';
import { AppSettingsStore } from './appSettingsStore.js';
import { TeamService, ServiceError } from './teamService.js';
import { SubaccountService } from './subaccountService.js';
import { SubaccountStore } from './subaccountStore.js';
import {
  createAccountRegistrarClient,
  type AccountRegistrarGateway
} from './accountRegistrarClient.js';
import type { Transport } from './transport.js';
import { isEditableMemberRole } from '@team-manager/shared';
import type {
  InviteRequest,
  PublicSeatSwapRequest,
  SeatType,
  Subaccount
} from '@team-manager/shared';

export interface BuildAppDeps {
  config: AppConfig;
  store: AccountStore;
  subaccountStore: SubaccountStore;
  subaccountQuotaTransport?: Transport;
  subaccountRegistrar?: AccountRegistrarGateway;
  teamTransport?: Transport;
  settingsStore?: AppSettingsStore;
  billingStore?: AccountBillingStore;
}

// 恒定时间字符串比较，避免 token 校验的时序侧信道
function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function chatGptUserIdFromAccessToken(accessToken: string): string {
  const payloadPart = accessToken.split('.')[1];
  if (!payloadPart) return '';
  try {
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as Record<string, unknown>;
    const auth = payload['https://api.openai.com/auth'];
    if (auth && typeof auth === 'object') {
      const authRecord = auth as Record<string, unknown>;
      const authUserId = readTrimmedString(authRecord.chatgpt_user_id) || readTrimmedString(authRecord.user_id);
      if (authUserId) return authUserId;
    }
    return readTrimmedString(payload.chatgpt_user_id) || readTrimmedString(payload.user_id) || '';
  } catch {
    return '';
  }
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function buildApp({
  config,
  store,
  subaccountStore,
  subaccountQuotaTransport,
  subaccountRegistrar,
  teamTransport,
  settingsStore,
  billingStore
}: BuildAppDeps): Promise<Hono> {
  const app = new Hono();
  const accountBillingStore = billingStore ?? new AccountBillingStore(config.dataDir);
  await accountBillingStore.init();
  const service = new TeamService(store, teamTransport, accountBillingStore);
  const appSettingsStore = settingsStore ?? new AppSettingsStore(config.dataDir);
  await appSettingsStore.init();
  const subaccountService = new SubaccountService(
    subaccountStore,
    subaccountQuotaTransport,
    teamTransport,
    subaccountRegistrar ?? createAccountRegistrarClient()
  );

  const syncTeamLinksByChildWorkspaces = async (id: string, subaccount: Subaccount) => {
    if (!subaccount.webAccessToken?.trim() || !subaccount.chatgptAccountId?.trim()) {
      await subaccountStore.appendLog(id, {
        phase: 'team_link_sync',
        status: 'error',
        message: '子号缺少 ChatGPT Web session，无法从子号侧同步 Team 关联',
        data: { source: 'child_accounts_check' }
      });
      throw new ServiceError(400, '子号缺少 ChatGPT Web session，无法从子号侧同步 Team 关联');
    }

    let childWebAccessToken = subaccount.webAccessToken;
    const updateChildWebAccessToken = async (accessToken: string) => {
      childWebAccessToken = accessToken;
      await subaccountStore.update(id, { webAccessToken: accessToken, lastError: undefined });
    };

    let childAccounts;
    try {
      childAccounts = await service.checkSessionAccounts({
        accountId: subaccount.chatgptAccountId,
        accessToken: childWebAccessToken,
        proxy: subaccount.proxy,
        sessionToken: subaccount.sessionToken,
        onAccessTokenRefreshed: updateChildWebAccessToken
      });
    } catch (e) {
      await subaccountStore.appendLog(id, {
        phase: 'team_link_sync',
        status: 'error',
        message: `子号 Team 列表刷新失败: ${(e as Error).message}`,
        data: { source: 'child_accounts_check' }
      });
      throw new ServiceError(502, `子号 Team 列表刷新失败: ${(e as Error).message}`);
    }

    const parentByWorkspaceId = new Map((await service.listAccounts()).map((account) => [account.accountId, account]));
    const existingLinks = new Map((subaccount.teamLinks ?? []).map((link) => [link.accountId, link]));
    const existingLinksByWorkspaceId = new Map(
      (subaccount.teamLinks ?? [])
        .filter((link) => link.workspaceId?.trim())
        .map((link) => [link.workspaceId!.trim(), link])
    );
    const matchedLinkIds = new Set<string>();
    const matchedWorkspaceIds = new Set<string>();
    const errors: Array<{ accountId: string; message: string }> = [];
    let updated = subaccountStore.list().find((item) => item.id === id);
    let found = 0;
    let removed = 0;
    let unknown = 0;

    for (const childAccount of childAccounts) {
      if (!isTeamWorkspaceAccount(childAccount)) continue;
      const parent = parentByWorkspaceId.get(childAccount.accountId);
      const linkAccountId = parent?.id ?? childAccount.accountId;
      const existing = existingLinks.get(linkAccountId) ?? existingLinksByWorkspaceId.get(childAccount.accountId);
      matchedLinkIds.add(linkAccountId);
      if (existing) matchedLinkIds.add(existing.accountId);
      matchedWorkspaceIds.add(childAccount.accountId);
      try {
        const relation = await service.findSessionEmailRelation(
          {
            accountId: childAccount.accountId,
            accessToken: childWebAccessToken,
            proxy: subaccount.proxy,
            sessionToken: subaccount.sessionToken,
            onAccessTokenRefreshed: updateChildWebAccessToken
          },
          subaccount.email
        );
        if (relation.status !== 'member') {
          updated = await subaccountStore.saveTeamLink(id, {
            accountId: linkAccountId,
            workspaceId: childAccount.accountId,
            workspaceName: childAccount.workspaceName,
            planType: childAccount.planType,
            role: childAccount.role,
            seat: existing?.seat ?? 'usage_based',
            status: 'unknown'
          });
          unknown += 1;
          continue;
        }
        updated = await subaccountStore.saveTeamLink(id, {
          accountId: linkAccountId,
          workspaceId: childAccount.accountId,
          workspaceName: childAccount.workspaceName,
          planType: childAccount.planType,
          role: childAccount.role,
          seat: relation.seat ?? existing?.seat ?? 'usage_based',
          status: 'member'
        });
        found += 1;
      } catch (e) {
        errors.push({ accountId: linkAccountId, message: (e as Error).message });
        updated = await subaccountStore.saveTeamLink(id, {
          accountId: linkAccountId,
          workspaceId: childAccount.accountId,
          workspaceName: childAccount.workspaceName,
          planType: childAccount.planType,
          role: childAccount.role,
          seat: existing?.seat ?? 'usage_based',
          status: 'unknown'
        });
        unknown += 1;
      }
    }

    for (const existing of existingLinks.values()) {
      if (matchedLinkIds.has(existing.accountId)) continue;
      if (existing.workspaceId && matchedWorkspaceIds.has(existing.workspaceId)) continue;
      updated = await subaccountStore.removeTeamLink(id, existing.workspaceId || existing.accountId);
      removed += 1;
    }

    await subaccountStore.appendLog(id, {
      phase: 'team_link_sync',
      status: errors.length ? 'partial' : 'success',
      message: `已通过子号可见 workspace 同步 ${found} 个 Team 关联`,
      data: {
        source: 'child_accounts_check',
        visibleAccountCount: childAccounts.length,
        found,
        removed,
        unknown,
        errorCount: errors.length,
        errors
      }
    });

    return updated ?? subaccountStore.list().find((item) => item.id === id);
  };

  const leaveTeamLinkByChild = async (id: string, targetAccountId: string) => {
    const requested = targetAccountId.trim();
    if (!requested) throw new ServiceError(400, '缺少 Team workspace ID');
    const subaccount = subaccountStore.get(id);
    if (!subaccount) throw new ServiceError(404, `子号不存在: ${id}`);
    if (!subaccount.webAccessToken?.trim() || !subaccount.chatgptAccountId?.trim()) {
      await subaccountStore.appendLog(id, {
        phase: 'team_link_leave',
        status: 'error',
        message: '子号缺少 ChatGPT Web session，无法从子号侧退出 Team',
        data: { targetAccountId: requested }
      });
      throw new ServiceError(400, '子号缺少 ChatGPT Web session，无法从子号侧退出 Team');
    }

    const childUserId = chatGptUserIdFromAccessToken(subaccount.webAccessToken);
    if (!childUserId) {
      await subaccountStore.appendLog(id, {
        phase: 'team_link_leave',
        status: 'error',
        message: '子号 Web accessToken 缺少 ChatGPT 用户 ID，无法从子号侧退出 Team',
        data: { targetAccountId: requested }
      });
      throw new ServiceError(400, '子号 Web accessToken 缺少 ChatGPT 用户 ID，无法从子号侧退出 Team');
    }

    const parents = await service.listAccounts();
    const parentByInternalId = new Map(parents.map((account) => [account.id, account]));
    const parentByWorkspaceId = new Map(parents.map((account) => [account.accountId, account]));
    const link = (subaccount.teamLinks ?? []).find((item) => {
      const parent = parentByInternalId.get(item.accountId);
      return item.accountId === requested || item.workspaceId === requested || parent?.accountId === requested;
    });
    if (!link) throw new ServiceError(404, `子号 Team 关联不存在: ${requested}`);

    const parent = parentByInternalId.get(link.accountId) ?? parentByWorkspaceId.get(requested);
    const workspaceId = (link.workspaceId || parent?.accountId || requested).trim();
    if (!workspaceId) throw new ServiceError(400, '缺少 Team workspace ID');

    let childWebAccessToken = subaccount.webAccessToken;
    const updateChildWebAccessToken = async (accessToken: string) => {
      childWebAccessToken = accessToken;
      await subaccountStore.update(id, { webAccessToken: accessToken, lastError: undefined });
    };

    try {
      await service.removeSessionMember(
        {
          accountId: workspaceId,
          accessToken: childWebAccessToken,
          proxy: subaccount.proxy,
          sessionToken: subaccount.sessionToken,
          onAccessTokenRefreshed: updateChildWebAccessToken
        },
        childUserId
      );
    } catch (e) {
      await subaccountStore.appendLog(id, {
        phase: 'team_link_leave',
        status: 'error',
        message: `子号退出 Team 失败: ${(e as Error).message}`,
        data: { accountId: link.accountId, workspaceId, userId: childUserId }
      });
      throw new ServiceError(502, `子号退出 Team 失败: ${(e as Error).message}`);
    }

    const updated = await subaccountStore.removeTeamLink(id, workspaceId);
    await subaccountStore.appendLog(id, {
      phase: 'team_link_leave',
      status: 'success',
      message: '子号已从 Team workspace 自行退出',
      data: { accountId: link.accountId, workspaceId, userId: childUserId }
    });
    return updated ?? subaccountStore.list().find((item) => item.id === id);
  };

  function isTeamWorkspaceAccount(account: {
    accountId: string;
    structure?: string;
    planType?: string;
    canAccessWithSession?: boolean;
  }): boolean {
    if (!account.accountId) return false;
    if (account.structure === 'personal') return false;
    if (account.planType === 'free') return false;
    if (account.canAccessWithSession === false) return false;
    return true;
  }

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

  // ---- 免登录席位页 ----
  app.get('/public/seat-slots/:seatKey', (c) =>
    wrap(c, () => service.getPublicSeatSlot(c.req.param('seatKey')))
  );

  app.post('/public/seat-slots/:seatKey/swap', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Partial<PublicSeatSwapRequest>;
    if (!body.email?.trim()) return c.json({ ok: false, error: '缺少 email' }, 400);
    return wrap(c, () => service.swapPublicSeatSlotEmail(c.req.param('seatKey'), body.email!));
  });

  // ---- 全局设置 ----
  api.get('/settings/notifications', (c) =>
    wrap(c, () => Promise.resolve(appSettingsStore.getNotificationSettings()))
  );

  api.patch('/settings/notifications', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    return wrap(c, () => appSettingsStore.updateNotificationSettings(body));
  });

  // ---- 母号 ----
  api.get('/accounts', (c) => wrap(c, () => service.listAccounts()));

  api.post('/accounts', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    return wrap(c, () => service.addAccountFromSessionInput(body));
  });

  api.delete('/accounts/:id', (c) => wrap(c, () => service.removeAccount(c.req.param('id'))));

  api.patch('/accounts/:id/local-profile', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      remark?: unknown;
      groupName?: unknown;
      limitType?: unknown;
      nextRenewalOn?: unknown;
      proxy?: unknown;
      session?: unknown;
    };
    return wrap(c, () => service.updateLocalProfile(c.req.param('id'), body));
  });

  api.post('/accounts/:id/refresh', (c) => wrap(c, () => service.refreshAccount(c.req.param('id'))));

  api.get('/accounts/:id/billing', (c) => wrap(c, () => service.getCachedBillingSnapshot(c.req.param('id'))));

  api.post('/accounts/:id/billing/refresh', (c) =>
    wrap(c, () => service.refreshBillingSnapshot(c.req.param('id')))
  );

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
        confirmBillingRisk: body.confirmBillingRisk,
        seatSlotProfile: body.seatSlotProfile
      })
    );
  });

  api.patch('/accounts/:id/seat-slots/profile', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      email?: string;
      remark?: string;
      expiresOn?: string;
      expireRemove?: boolean;
      expireReminder?: boolean;
    };
    if (!body.email?.trim()) return c.json({ ok: false, error: '缺少 email' }, 400);
    return wrap(c, () =>
      service.updateSeatSlotProfile(c.req.param('id'), body.email!, {
        remark: body.remark,
        expiresOn: body.expiresOn,
        expireRemove: body.expireRemove,
        expireReminder: body.expireReminder
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

  api.patch('/accounts/:id/members/:userId/role', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      role?: unknown;
      confirmOwnerRisk?: boolean;
    };
    if (body.role === undefined || body.role === null || body.role === '') {
      return c.json({ ok: false, error: '缺少 role' }, 400);
    }
    if (!isEditableMemberRole(body.role)) {
      return c.json({ ok: false, error: '不支持的成员角色' }, 400);
    }
    const role = body.role;
    return wrap(c, () =>
      service.setMemberRole(
        c.req.param('id'),
        c.req.param('userId'),
        role,
        body.confirmOwnerRisk === true
      )
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
      codexDeviceCodeAuthEnabled?: boolean;
      codexRemoteControlEnabled?: boolean;
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
    if (typeof body.codexDeviceCodeAuthEnabled === 'boolean') {
      return wrap(c, () =>
        service.setCodexDeviceCodeAuthEnabled(c.req.param('id'), body.codexDeviceCodeAuthEnabled!)
      );
    }
    if (typeof body.codexRemoteControlEnabled === 'boolean') {
      return wrap(c, () =>
        service.setCodexRemoteControlEnabled(c.req.param('id'), body.codexRemoteControlEnabled!)
      );
    }
    return c.json({
      ok: false,
      error:
        '缺少 defaultSeat、workspaceReferralsEnabled、personalAccessTokensEnabled、codexDeviceCodeAuthEnabled 或 codexRemoteControlEnabled'
    }, 400);
  });

  api.patch('/accounts/:id/name', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { name?: string };
    if (!body.name?.trim()) return c.json({ ok: false, error: '缺少 Team 名称' }, 400);
    return wrap(c, () => service.renameTeam(c.req.param('id'), body.name!));
  });

  // ---- 子号池 ----
  api.get('/subaccounts', (c) => wrap(c, () => Promise.resolve(subaccountService.list())));

  api.get('/subaccounts/registration/jobs', (c) =>
    wrap(c, () => subaccountService.listRegistrationJobs())
  );

  api.post('/subaccounts/registration/jobs/:jobId/retry', (c) =>
    wrap(c, () => subaccountService.retrySubaccountRegistration(c.req.param('jobId')))
  );

  api.delete('/subaccounts/registration/jobs/:jobId', (c) =>
    wrap(c, () => subaccountService.removeSubaccountRegistrationJob(c.req.param('jobId')))
  );

  api.post('/subaccounts/session', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    return wrap(c, () => subaccountService.importSession(body));
  });

  api.post('/subaccounts/registration/start', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      mailGroup?: string;
      email?: string;
      password?: string;
      resumeExisting?: boolean;
    };
    return wrap(c, () =>
      subaccountService.startSubaccountRegistration({
        mailGroup: body.mailGroup,
        email: body.email,
        password: body.password,
        resumeExisting: body.resumeExisting
      })
    );
  });

  api.patch('/subaccounts/:id/local-profile', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      remark?: unknown;
      groupName?: unknown;
      proxy?: unknown;
      session?: unknown;
    };
    return wrap(c, () => subaccountService.updateLocalProfile(c.req.param('id'), body));
  });

  api.post('/subaccounts/:id/refresh', (c) =>
    wrap(c, () => subaccountService.refreshWebAccount(c.req.param('id')))
  );

  api.patch('/subaccounts/:id/personal-settings', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      marketingPushEnabled?: unknown;
      marketingEmailEnabled?: unknown;
      memoryEnabled?: unknown;
      username?: unknown;
      displayName?: unknown;
    };
    if (
      typeof body.marketingPushEnabled === 'boolean' ||
      typeof body.marketingEmailEnabled === 'boolean'
    ) {
      return wrap(c, () =>
        subaccountService.setMarketingNotifications(c.req.param('id'), {
          ...(typeof body.marketingPushEnabled === 'boolean' ? { push: body.marketingPushEnabled } : {}),
          ...(typeof body.marketingEmailEnabled === 'boolean' ? { email: body.marketingEmailEnabled } : {})
        })
      );
    }
    if (typeof body.memoryEnabled === 'boolean') {
      return wrap(c, () => subaccountService.setMemoryEnabled(c.req.param('id'), body.memoryEnabled as boolean));
    }
    if (body.username !== undefined || body.displayName !== undefined) {
      if (body.username !== undefined && typeof body.username !== 'string') {
        return c.json({ ok: false, error: 'username 必须是字符串' }, 400);
      }
      if (body.displayName !== undefined && typeof body.displayName !== 'string') {
        return c.json({ ok: false, error: 'displayName 必须是字符串' }, 400);
      }
      const username = typeof body.username === 'string' ? body.username.trim() : undefined;
      const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : undefined;
      if (body.username !== undefined && !username) return c.json({ ok: false, error: 'username 不能为空' }, 400);
      if (body.displayName !== undefined && !displayName) {
        return c.json({ ok: false, error: 'displayName 不能为空' }, 400);
      }
      return wrap(c, () =>
        subaccountService.updatePersonalProfile(c.req.param('id'), {
          ...(username ? { username } : {}),
          ...(displayName ? { displayName } : {})
        })
      );
    }
    return c.json({
      ok: false,
      error: '缺少营销通知、记忆、username 或 displayName 设置'
    }, 400);
  });

  api.get('/subaccounts/logs', (c) => wrap(c, () => Promise.resolve(subaccountService.listLogs())));

  api.delete('/subaccounts/:id', (c) => wrap(c, () => subaccountService.remove(c.req.param('id'))));

  api.get('/subaccounts/registration/status', (c) =>
    wrap(c, () => subaccountService.getRegistrationRuntimeStatus())
  );

  api.post('/subaccounts/:id/pat-credentials', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { chatgptAccountId?: string };
    return wrap(c, () =>
      subaccountService.createPersonalAccessTokenCredential(c.req.param('id'), body.chatgptAccountId)
    );
  });

  api.get('/subaccounts/:id/pat-credentials', (c) =>
    wrap(c, () =>
      Promise.resolve(subaccountService.getCodexCredential(c.req.param('id'), c.req.query('chatgptAccountId')))
    )
  );

  api.delete('/subaccounts/:id/pat-credentials', (c) =>
    wrap(c, () => subaccountService.removeCodexCredential(c.req.param('id'), c.req.query('chatgptAccountId')))
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
      return syncTeamLinksByChildWorkspaces(id, subaccount);
    })
  );

  api.delete('/subaccounts/:id/team-links/:accountId', (c) =>
    wrap(c, () => leaveTeamLinkByChild(c.req.param('id'), c.req.param('accountId')))
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
