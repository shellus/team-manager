import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync } from 'node:fs';
import { relative } from 'node:path';
import type { Kysely } from 'kysely';
import type { AppConfig } from './config.js';
import type { Database } from './database/schema.js';
import { verifyJwt, signJwt } from './auth/jwt.js';
import { verifyPasswordHash } from './auth/password.js';
import { ArtifactStore } from './artifactStore.js';
import { SecretCipher } from './secretCipher.js';
import { AccountOperationalRepository } from './repositories/accountOperationalRepository.js';
import { SessionRepository } from './repositories/sessionRepository.js';
import { UnifiedProjectionRepository } from './repositories/unifiedProjectionRepository.js';
import { UnifiedAccountService } from './services/unifiedAccountService.js';
import { WorkspaceService } from './services/workspaceService.js';
import { WorkspaceOperationService } from './services/workspaceOperationService.js';
import { ServiceError, asServiceError } from './serviceError.js';
import type { AccountListFilters } from './repositories/accountRepository.js';
import { configureTransportRuntime, createTransport, type Transport } from './transport.js';
import { isEditableMemberRole } from '@team-manager/shared';
import type {
  AddSubscriptionPaymentMethodRequest,
  AccountDeletionResult,
  BulkUpdateAccountsRequest,
  ChangePersonalSubscriptionRequest,
  GenerateWorkspaceOrderLinkRequest,
  OpenBusinessSubscriptionRequest,
  RegisterAccountRequest,
  ResidentialProxyConfig,
  WorkspaceInvitationMutationInput
} from '@team-manager/shared';
import { AccountManagerClient, type AccountManagerGateway } from './accountManagerClient.js';
import { SubscriptionService } from './services/subscriptionService.js';
import { PublicSeatService } from './services/publicSeatService.js';
import { AccountManagerService } from './services/accountManagerService.js';
import { ArtifactIndexRepository } from './repositories/artifactIndexRepository.js';
import { SystemService } from './services/systemService.js';
import { CredentialService } from './services/credentialService.js';
import { PersonalSpaceService } from './services/personalSpaceService.js';
import { OperationService, startOperationPoller } from './services/operationService.js';
import { SeatSlotService, startSeatExpirationScheduler } from './services/seatSlotService.js';
import { NotificationService } from './services/notificationService.js';
import { ArtifactService, startArtifactCleanupScheduler } from './services/artifactService.js';
import { SettingsService } from './services/settingsService.js';
import { TeamOrderService, startTeamOrderScheduler } from './services/teamOrderService.js';
import { TeamCodeClient, type TeamCodeGateway } from './teamCodeClient.js';
import { WorkspaceOrderLinkService } from './services/workspaceOrderLinkService.js';
import {
  HttpPaymentMethodBinder,
  NoTraceStripeTransport,
  SubscriptionPaymentMethodService,
  type PaymentMethodBinder
} from './services/paymentMethodService.js';

export interface UnifiedAppDeps {
  config: AppConfig;
  database: Kysely<Database>;
  artifactStore?: ArtifactStore;
  transport?: Transport;
  accountManager?: AccountManagerGateway;
  teamCode?: TeamCodeGateway;
  paymentMethodBinder?: PaymentMethodBinder;
  startBackgroundTasks?: boolean;
}

export type UnifiedApp = Hono & { stopBackgroundTasks(): void };

export async function buildUnifiedApp({ config, database, artifactStore, transport: providedTransport, accountManager: providedAccountManager, teamCode: providedTeamCode, paymentMethodBinder: providedPaymentMethodBinder, startBackgroundTasks = false }: UnifiedAppDeps): Promise<UnifiedApp> {
  const app = new Hono();
  configureTransportRuntime(config);
  const transport = providedTransport ?? createTransport(config.curlCffiUrl);
  const cipher = new SecretCipher(config.dataEncryptionKey, config.dataEncryptionKeyVersion);
  const artifactsStore = artifactStore ?? new ArtifactStore(config.artifactDir);
  const sessions = new SessionRepository(database, cipher);
  const operational = new AccountOperationalRepository(database, cipher);
  const projections = new UnifiedProjectionRepository(database, sessions);
  const accounts = new UnifiedAccountService(
    database, projections, sessions, operational, artifactsStore
  );
  const workspaces = new WorkspaceService(projections);
  const accountManager = providedAccountManager ?? (config.accountManagerBaseUrl && config.accountManagerToken
    ? new AccountManagerClient(config.accountManagerBaseUrl, config.accountManagerToken)
    : undefined);
  const accountManagement = new AccountManagerService(database, sessions, accountManager, operational);
  const personalSpaces = new PersonalSpaceService(database, sessions, operational, transport, accountManagement);
  const workspaceOperations = new WorkspaceOperationService(
    database, workspaces, sessions, operational, transport, accountManagement
  );
  const paymentMethodBinder = providedPaymentMethodBinder ?? new HttpPaymentMethodBinder(
    transport,
    new NoTraceStripeTransport(),
    config
  );
  const paymentMethods = new SubscriptionPaymentMethodService(
    database,
    sessions,
    operational,
    paymentMethodBinder,
    accountManagement,
    personalSpaces,
    workspaceOperations,
    config
  );
  const subscriptions = new SubscriptionService(database, accountManager, personalSpaces);
  const publicSeats = new PublicSeatService(database, workspaceOperations);
  const artifactIndexes = new ArtifactIndexRepository(database, artifactsStore);
  const teamCode = providedTeamCode ?? new TeamCodeClient(config.teamCodeBaseUrl, config.teamCodePasscode);
  const system = new SystemService(database, teamCode.configured);
  const credentials = new CredentialService(
    database,
    artifactsStore,
    sessions,
    operational,
    transport,
    cipher
  );
  const operations = new OperationService(database, accountManagement, accountManager, personalSpaces, workspaceOperations);
  const notifications = new NotificationService(database);
  const seatSlots = new SeatSlotService(database, workspaceOperations, notifications);
  const artifacts = new ArtifactService(database, artifactsStore, config.artifactDir);
  const settings = new SettingsService(database, cipher);
  const teamOrders = new TeamOrderService(database, sessions, operational, teamCode);
  const workspaceOrderLinks = new WorkspaceOrderLinkService(database, personalSpaces, teamCode);
  const stops: Array<() => void> = [];
  if (startBackgroundTasks) {
    stops.push(startOperationPoller(operations), startTeamOrderScheduler(teamOrders),
      startSeatExpirationScheduler(seatSlots), startArtifactCleanupScheduler(artifacts));
    const notificationTimer = setInterval(() => void notifications.retryFailed().catch((error) => console.warn('[team-manager] 通知重试失败:', error)), 60_000);
    notificationTimer.unref(); stops.push(() => clearInterval(notificationTimer));
  }
  const adminHash = config.adminPasswordHash;

  if (config.allowedOrigins.length > 0) {
    app.use('*', cors({
      origin: (origin) => config.allowedOrigins.includes(origin) ? origin : config.allowedOrigins[0]!,
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'], credentials: true
    }));
  }
  app.get('/health', (c) => c.json({ ok: true, mode: 'unified-account-postgresql' }));
  app.get('/public/seat-slots/:seatKey', (c) => wrapPublic(c, () => publicSeats.get(c.req.param('seatKey'))));
  app.post('/public/seat-slots/:seatKey/swap', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { email?: string };
    if (!body.email) return c.json({ ok: false, error: '缺少邮箱' }, 400);
    return wrapPublic(c, () => publicSeats.swap(c.req.param('seatKey'), body.email!));
  });
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
    catch (error) { return serviceErrorResponse(c, error); }
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
  api.put('/account-groups/order', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { ids?: string[] };
    return wrap(c, () => accounts.reorderGroups(body.ids ?? []));
  });
  api.delete('/account-groups/:id', (c) => wrap(c, () => accounts.deleteGroup(c.req.param('id'))));

  api.get('/accounts', (c) => wrap(c, () => accounts.list(accountFilters(c))));
  api.get('/account-registrations', (c) => wrap(c, () => accounts.registrations(accountFilters(c))));
  api.post('/accounts', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    return wrap(c, () => accounts.create(body));
  });
  api.patch('/accounts/bulk', async (c) => {
    const body = await c.req.json().catch(() => ({})) as BulkUpdateAccountsRequest;
    return wrap(c, () => accounts.bulkUpdate(body));
  });
  api.get('/accounts/:id', (c) => wrap(c, () => accounts.detail(c.req.param('id'))));
  api.get('/accounts/:accountId/workspaces/:workspaceId', (c) =>
    wrap(c, () => workspaces.detailForAccount(c.req.param('workspaceId'), c.req.param('accountId')))
  );
  api.delete('/accounts/:accountId/workspaces/:workspaceId/removed-record', (c) =>
    wrap(c, () => workspaceOperations.removeAccountWorkspaceExitRecord(
      c.req.param('accountId'),
      c.req.param('workspaceId')
    ))
  );
  api.post('/accounts/:id/workspaces/sync', (c) =>
    wrap(c, () => workspaceOperations.syncAccountRelationships(c.req.param('id')))
  );
  api.post('/accounts/:id/workspaces/join-request', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { workspaceId?: string };
    if (!body.workspaceId?.trim()) return c.json({ ok: false, error: '缺少 Workspace ID' }, 400);
    return wrap(c, () => workspaceOperations.requestWorkspaceJoin(c.req.param('id'), body.workspaceId!));
  });
  api.post('/accounts/:id/workspace-order-link', async (c) => {
    const body = await c.req.json().catch(() => ({})) as GenerateWorkspaceOrderLinkRequest;
    return wrap(c, () => workspaceOrderLinks.generate(c.req.param('id'), body));
  });
  api.get('/accounts/:id/session', (c) => wrap(c, () => accounts.session(c.req.param('id'))));
  api.patch('/accounts/:id', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    return wrap(c, () => accounts.update(c.req.param('id'), body));
  });
  api.get('/accounts/:id/deletion-preview', (c) => wrap(c, () => accounts.deletionPreview(c.req.param('id'))));
  api.delete('/accounts/:id', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { confirmLocalCascade?: boolean };
    if (body.confirmLocalCascade !== true) {
      return c.json({ ok: false, error: '请先预览并确认本地级联删除' }, 400);
    }
    return wrap(c, () => accounts.remove(c.req.param('id')) as Promise<AccountDeletionResult>);
  });
  api.post('/accounts/:id/personal-subscription', async (c) => {
    const body = await c.req.json().catch(() => ({})) as ChangePersonalSubscriptionRequest;
    return wrap(c, () => subscriptions.changePersonalSubscription(c.req.param('id'), body));
  });
  api.get('/accounts/:id/personal-subscription/preview', (c) =>
    wrap(c, () => subscriptions.previewPersonalSubscriptionChange(
      c.req.param('id'),
      c.req.query('targetPlan') as ChangePersonalSubscriptionRequest['targetPlan']
    ))
  );
  api.post('/accounts/:id/personal-subscription/cancel-renewal', (c) =>
    wrap(c, () => personalSpaces.cancelRenewal(c.req.param('id')))
  );
  api.post('/accounts/:id/business-subscription', async (c) => {
    const body = await c.req.json().catch(() => ({})) as OpenBusinessSubscriptionRequest;
    return wrap(c, () => subscriptions.openBusiness(c.req.param('id'), body));
  });
  api.get('/accounts/:id/account-manager', (c) => wrap(c, () => accountManagement.state(c.req.param('id'))));
  api.post('/accounts/:id/account-manager/enroll', (c) => wrap(c, () => accountManagement.enroll(c.req.param('id'))));
  api.post('/accounts/:id/account-manager/profile/start', (c) => wrap(c, () => accountManagement.startProfile(c.req.param('id'))));
  api.post('/accounts/:id/account-manager/profile/stop', (c) => wrap(c, () => accountManagement.stopProfile(c.req.param('id'))));
  api.post('/accounts/:id/account-manager/session/refresh', (c) =>
    wrap(c, () => accountManagement.refreshSession(c.req.param('id')))
  );
  api.put('/accounts/:id/account-manager/proxy', async (c) => {
    const body = await c.req.json().catch(() => ({})) as ResidentialProxyConfig;
    return wrap(c, () => accountManagement.setProxy(c.req.param('id'), body));
  });
  api.get('/accounts/:id/payment-method-defaults', (c) => wrap(c, () => paymentMethods.defaults(c.req.param('id'))));
  api.post('/accounts/:id/personal-space/payment-methods', async (c) => {
    const body = await c.req.json().catch(() => ({})) as AddSubscriptionPaymentMethodRequest;
    return wrap(c, () => paymentMethods.addPersonal(c.req.param('id'), body));
  });
  api.post('/accounts/:id/personal-space/payment-methods/:paymentMethodId/default', (c) =>
    wrap(c, () => paymentMethods.setPersonalDefault(c.req.param('id'), c.req.param('paymentMethodId')))
  );
  api.delete('/accounts/:id/personal-space/payment-methods/:paymentMethodId', (c) =>
    wrap(c, () => paymentMethods.removePersonal(c.req.param('id'), c.req.param('paymentMethodId')))
  );
  api.post('/accounts/:id/personal-space/refresh', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { resources?: string[] };
    return wrap(c, () => personalSpaces.refresh(c.req.param('id'), body.resources));
  });
  api.get('/accounts/:id/personal-space', (c) => wrap(c, () => personalSpaces.view(c.req.param('id'))));
  api.get('/accounts/:id/personal-space/billing', (c) => wrap(c, () => personalSpaces.billing(c.req.param('id'))));
  api.get('/accounts/:id/personal-space/quota', (c) => wrap(c, () => personalSpaces.quota(c.req.param('id'))));
  api.get('/accounts/:id/personal-space/settings', (c) => wrap(c, () => personalSpaces.settings(c.req.param('id'))));
  api.patch('/accounts/:id/personal-space/settings', async (c) => { const body=await c.req.json(); return wrap(c, () => personalSpaces.patchSettings(c.req.param('id'), body)); });
  api.get('/accounts/:id/personal-space/activity', (c) => wrap(c, () => personalSpaces.activities(c.req.param('id'), Number(c.req.query('limit') || 200))));
  api.post('/operations/registrations', async (c) => {
    const body = await c.req.json().catch(() => ({})) as RegisterAccountRequest;
    if (!body.groupId) return c.json({ ok: false, error: '缺少目标分组' }, 400);
    return wrap(c, () => accountManagement.register(body));
  });
  api.get('/operations/registrations/:operationId', (c) => wrap(c, () => accountManagement.registration(c.req.param('operationId'))));
  api.get('/operations/registrations/:operationId/proxy', (c) => wrap(c, () => accountManagement.registrationProxy(c.req.param('operationId'))));
  api.put('/operations/registrations/:operationId/proxy', async (c) => {
    const body = await c.req.json().catch(() => ({})) as ResidentialProxyConfig;
    return wrap(c, () => accountManagement.setRegistrationProxy(c.req.param('operationId'), body));
  });
  api.get('/operations/:operationId', (c) => wrap(c, () => operations.get(c.req.param('operationId'))));
  api.post('/operations/:operationId/controls/:control', (c) => wrap(c, () => operations.control(c.req.param('operationId'), c.req.param('control') as any)));
  api.put('/operations/:operationId/payment-card', async (c) => { const body=await c.req.json().catch(()=>({})) as any; return wrap(c,()=>operations.replacePaymentCard(c.req.param('operationId'),body.card??body)); });
  api.delete('/operations/:operationId', (c) => wrap(c, () => operations.remove(c.req.param('operationId'))));
  api.post('/artifacts/rrweb', async (c) => {
    const content = new Uint8Array(await c.req.arrayBuffer());
    if (content.byteLength === 0) return c.json({ ok: false, error: 'rrweb 文件为空' }, 400);
    return wrap(c, () => artifactIndexes.save('rrweb', {
      fileName: c.req.header('x-artifact-file-name') || `${Date.now()}.json.gz`,
      content,
      recordedAt: c.req.header('x-recorded-at') || new Date(),
      metadata: { source: 'runtime-upload', contentType: c.req.header('content-type') || 'application/gzip' }
    }));
  });
  api.post('/accounts/:accountId/workspaces/:workspaceId/credentials/pat', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { name?: string; ttl?: number; poolGroupId?: string };
    return wrap(c, () => credentials.createPat(c.req.param('accountId'), c.req.param('workspaceId'), body));
  });
  api.post('/accounts/:accountId/workspaces/:workspaceId/credentials/oauth', async (c) => wrap(c, () => credentials.startOauth(c.req.param('accountId'), c.req.param('workspaceId'))));
  api.put('/credentials/oauth/:sessionId', async (c) => { const body=await c.req.json().catch(()=>({})) as {callbackUrl?:string;poolGroupId?:string}; if(!body.callbackUrl)return c.json({ok:false,error:'缺少 callbackUrl'},400); return wrap(c,()=>credentials.completeOauth(c.req.param('sessionId'),body.callbackUrl!,body.poolGroupId)); });
  api.get('/credentials/:credentialId/content', (c) => wrap(c, () => credentials.content(c.req.param('credentialId'))));
  api.get('/credentials/:credentialId/download', (c) => wrap(c, () => credentials.content(c.req.param('credentialId'))));
  api.put('/credentials/:credentialId/content', async (c) => { const body=await c.req.json().catch(()=>({})); return wrap(c,()=>credentials.replace(c.req.param('credentialId'),body)); });
  api.patch('/credentials/:credentialId', async (c) => { const body=await c.req.json().catch(()=>({})) as any; return wrap(c,()=>credentials.setStatus(c.req.param('credentialId'),body.status)); });
  api.delete('/credentials/:credentialId', (c) => wrap(c, () => credentials.remove(c.req.param('credentialId'))));
  api.post('/credentials/:credentialId/quota/refresh', (c) => wrap(c, () => credentials.refreshQuota(c.req.param('credentialId'))));
  api.post('/credentials/:credentialId/deploy', async (c) => {const body=await c.req.json().catch(()=>({})) as any;return wrap(c,()=>credentials.deploy(c.req.param('credentialId'),body));});
  api.get('/credential-pool-groups', (c) => wrap(c, () => credentials.poolGroups()));
  api.post('/credential-pool-groups', async (c) => {const body=await c.req.json().catch(()=>({})) as any;return wrap(c,()=>credentials.createPoolGroup(body.name));});
  api.patch('/credential-pool-groups/:id', async (c) => {const body=await c.req.json();return wrap(c,()=>credentials.updatePoolGroup(c.req.param('id'),body));});
  api.delete('/credential-pool-groups/:id', (c) => wrap(c,()=>credentials.deletePoolGroup(c.req.param('id'))));
  api.get('/team-orders', (c) => wrap(c, () => system.teamOrders()));
  api.post('/team-orders/run', async (c) => {const body=await c.req.json().catch(()=>({})) as any;return wrap(c,()=>teamOrders.run(body));});
  api.post('/team-orders/maintenances/:workspaceId/:action', (c)=>wrap(c,()=>teamOrders.control(c.req.param('workspaceId'),c.req.param('action') as any)));
  api.post('/team-orders/orders/:orderId/retry', (c)=>wrap(c,()=>teamOrders.retry(c.req.param('orderId'))));
  api.delete('/team-orders/orders/:orderId', (c)=>wrap(c,()=>teamOrders.removeOrder(c.req.param('orderId'))));
  api.put('/team-orders/configuration', async (c) => {
    const body = await c.req.json().catch(() => ({})) as any;
    return wrap(c, () => system.saveTeamOrderConfiguration(body));
  });
  api.put('/team-orders/maintenances/:workspaceId', async (c) => {
    const body = await c.req.json().catch(() => ({})) as any;
    if (!body.executorAccountId) return c.json({ ok: false, error: '缺少执行账号' }, 400);
    return wrap(c, () => system.saveMaintenance({ ...body, workspaceId: c.req.param('workspaceId') }));
  });
  api.get('/settings/notification-policies', (c) => wrap(c, () => system.notificationPolicies()));
  api.put('/settings/notification-policies/:kind', async (c) => {
    const body = await c.req.json().catch(() => ({})) as any;
    return wrap(c, () => system.saveNotificationPolicy(c.req.param('kind'), body));
  });
  api.post('/settings/notification-policies/:kind/test', (c)=>wrap(c,()=>notifications.test(c.req.param('kind'))));
  api.get('/settings/notification-deliveries', (c)=>wrap(c,()=>notifications.deliveries(Number(c.req.query('limit')||200))));
  api.post('/settings/notification-deliveries/:id/retry', (c)=>wrap(c,()=>notifications.retry(c.req.param('id'))));
  api.get('/settings/system', (c)=>wrap(c,()=>settings.list()));
  api.put('/settings/system/:key', async (c)=>{const body=await c.req.json();return wrap(c,()=>settings.set(c.req.param('key'),body));});
  api.delete('/settings/system/:key', (c)=>wrap(c,()=>settings.remove(c.req.param('key'))));

  api.get('/workspaces', (c) => wrap(c, () => workspaces.list(c.req.query('query'))));
  api.get('/workspaces/:id/settings', (c)=>wrap(c,()=>workspaceOperations.settings(c.req.param('id'))));
  api.get('/workspaces/:id/billing', (c)=>wrap(c,()=>workspaceOperations.billing(c.req.param('id'))));
  api.get('/workspaces/:id/billing/invoices/:invoiceId', (c)=>wrap(c,()=>workspaceOperations.invoice(c.req.param('id'),c.req.param('invoiceId'))));
  api.get('/workspaces/:id/subscription', (c)=>wrap(c,()=>workspaceOperations.subscription(c.req.param('id'))));
  api.post('/workspaces/:id/subscription/refresh', async (c)=>withExecutor(c,(accountId)=>workspaceOperations.refreshSubscription(c.req.param('id'),accountId)));
  api.post('/workspaces/:id/subscription/cancel-renewal', async (c)=>withExecutor(c,(accountId)=>workspaceOperations.cancelRenewal(c.req.param('id'),accountId)));
  api.post('/workspaces/:id/payment-methods', async (c) => {
    const body = await c.req.json().catch(() => ({})) as AddSubscriptionPaymentMethodRequest & { executorAccountId?: string };
    if (!body.executorAccountId) return c.json({ ok: false, error: '缺少 executorAccountId' }, 400);
    const { executorAccountId, ...input } = body;
    return wrap(c, () => paymentMethods.addWorkspace(executorAccountId, c.req.param('id'), input));
  });
  api.post('/workspaces/:id/payment-methods/:paymentMethodId/default', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { executorAccountId?: string };
    if (!body.executorAccountId) return c.json({ ok: false, error: '缺少 executorAccountId' }, 400);
    const executorAccountId = body.executorAccountId;
    return wrap(c, () => paymentMethods.setWorkspaceDefault(
      executorAccountId, c.req.param('id'), c.req.param('paymentMethodId')
    ));
  });
  api.delete('/workspaces/:id/payment-methods/:paymentMethodId', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { executorAccountId?: string };
    if (!body.executorAccountId) return c.json({ ok: false, error: '缺少 executorAccountId' }, 400);
    const executorAccountId = body.executorAccountId;
    return wrap(c, () => paymentMethods.removeWorkspace(
      executorAccountId, c.req.param('id'), c.req.param('paymentMethodId')
    ));
  });
  api.post('/workspaces/:id/promotion/preview', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { executorAccountId?: string; promoCode?: string };
    if (!body.executorAccountId) return c.json({ ok: false, error: '缺少 executorAccountId' }, 400);
    return wrap(c, () => workspaceOperations.previewPromotion(c.req.param('id'), body.executorAccountId!, body));
  });
  api.post('/workspaces/:id/promotion/apply', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { executorAccountId?: string; promoCode?: string; acknowledgeRenewal?: boolean };
    if (!body.executorAccountId) return c.json({ ok: false, error: '缺少 executorAccountId' }, 400);
    return wrap(c, () => workspaceOperations.applyPromotion(c.req.param('id'), body.executorAccountId!, body));
  });
  api.post('/workspaces/:id/seat-slots', async (c)=>{const body=await c.req.json().catch(()=>({})) as any;if(!body.executorAccountId)return c.json({ok:false,error:'缺少执行账号'},400);const {executorAccountId,...input}=body;return wrap(c,()=>seatSlots.create(c.req.param('id'),executorAccountId,input));});
  api.patch('/workspaces/:id/seat-slots/:slotId', async (c)=>{const body=await c.req.json().catch(()=>({})) as any;if(!body.executorAccountId)return c.json({ok:false,error:'缺少执行账号'},400);const {executorAccountId,...input}=body;return wrap(c,()=>seatSlots.update(c.req.param('id'),c.req.param('slotId'),executorAccountId,input));});
  api.delete('/workspaces/:id/seat-slots/:slotId', async (c)=>{const body=await c.req.json().catch(()=>({})) as any;if(!body.executorAccountId)return c.json({ok:false,error:'缺少执行账号'},400);return wrap(c,()=>seatSlots.remove(c.req.param('id'),c.req.param('slotId'),body.executorAccountId));});
  api.post('/workspaces/:id/seat-slots/:slotId/release', async (c)=>{const body=await c.req.json().catch(()=>({})) as any;return wrap(c,()=>seatSlots.release(c.req.param('id'),c.req.param('slotId'),body.executorAccountId,body.force===true));});
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
  api.post('/workspaces/:id/people/refresh', async (c) => withExecutor(c, (accountId) => workspaceOperations.refreshPeople(c.req.param('id'), accountId)));
  api.post('/workspaces/:id/invitations', async (c) => {
    const body = await c.req.json().catch(() => ({})) as Partial<WorkspaceInvitationMutationInput> & { executorAccountId?: string };
    if (!body.executorAccountId || !body.email) return c.json({ ok: false, error: '缺少 executorAccountId 或 email' }, 400);
    if (body.seat !== undefined && body.seat !== 'default' && body.seat !== 'usage_based') return c.json({ ok: false, error: '无效 seat' }, 400);
    return wrap(c, () => seatSlots.invite(c.req.param('id'), body.executorAccountId!, {
      email: body.email!, seat: body.seat, role: body.role, contact: body.contact,
      remark: body.remark, price: body.price, expiresOn: body.expiresOn,
      expireReminder: body.expireReminder, expireRemove: body.expireRemove
    }));
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
    const hasSeat = body.seat !== undefined;
    const hasRole = body.role !== undefined;
    if (hasSeat === hasRole) return c.json({ ok: false, error: '每次只能修改 seat 或 role 中的一项' }, 400);
    if (hasSeat) {
      if (body.seat !== 'default' && body.seat !== 'usage_based') return c.json({ ok: false, error: '无效 seat' }, 400);
      return wrap(c, () => workspaceOperations.updateMemberSeat(c.req.param('id'), body.executorAccountId!, c.req.param('remoteUserId'), body.seat!));
    }
    if (!isEditableMemberRole(body.role)) return c.json({ ok: false, error: '无效 role' }, 400);
    const role = body.role;
    return wrap(c, () => workspaceOperations.updateMemberRole(c.req.param('id'), body.executorAccountId!, c.req.param('remoteUserId'), role));
  });
  api.post('/workspaces/:id/settings/refresh', async (c) => withExecutor(c, (accountId) => workspaceOperations.refreshSettings(c.req.param('id'), accountId)));
  api.patch('/workspaces/:id/settings', async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const executor = typeof body.executorAccountId === 'string' ? body.executorAccountId : '';
    if (!executor) return c.json({ ok: false, error: '缺少 executorAccountId' }, 400);
    const key = body.key;
    const booleanKeys = ['workspaceReferralsEnabled','autoAcceptRequests','personalAccessTokensEnabled','codexDeviceCodeAuthEnabled','codexRemoteControlEnabled','automaticReloadEnabled'] as const;
    if (key === 'defaultSeat' && (body.value === 'default' || body.value === 'usage_based')) {
      const value = body.value;
      return wrap(c, () => workspaceOperations.updateSetting(c.req.param('id'), executor, { key, value }));
    }
    if (typeof key === 'string' && (booleanKeys as readonly string[]).includes(key) && typeof body.value === 'boolean') {
      const value = body.value;
      return wrap(c, () => workspaceOperations.updateSetting(c.req.param('id'), executor, { key: key as typeof booleanKeys[number], value }));
    }
    return c.json({ ok: false, error: '缺少有效的 Workspace 设置项和值' }, 400);
  });
  api.post('/workspaces/:id/billing/refresh', async (c) => withExecutor(c, (accountId) => workspaceOperations.refreshBilling(c.req.param('id'), accountId)));
  api.get('/overview/renewals', (c)=>wrap(c,()=>system.overviewRenewals()));
  api.get('/overview/seats', (c)=>wrap(c,()=>system.overviewSeats()));
  api.get('/artifacts', (c)=>wrap(c,()=>artifacts.list(c.req.query('kind'),Number(c.req.query('limit')||500))));
  api.get('/artifacts/:kind/:id', async (c)=>{try{const content=await artifacts.read(c.req.param('kind'),c.req.param('id'));return new Response(new Uint8Array(content),{headers:{'content-type':'application/octet-stream'}});}catch(error){return wrap(c,()=>Promise.reject(error));}});
  api.delete('/artifacts/:kind/:id', (c)=>wrap(c,()=>artifacts.markDelete(c.req.param('kind'),c.req.param('id'))));
  api.post('/artifacts/quarantine/:id/claim', async (c)=>{const body=await c.req.json() as any;return wrap(c,()=>artifacts.claimQuarantine(c.req.param('id'),body));});
  api.delete('/artifacts/quarantine/:id', (c)=>wrap(c,()=>artifacts.discardQuarantine(c.req.param('id'))));
  api.post('/artifacts/verify', (c)=>wrap(c,()=>artifacts.verify()));

  app.route('/api', api);
  app.all('/api/*', (c) => c.json({ ok: false, error: 'API 不存在' }, 404));
  if (existsSync(config.webDistDir)) {
    const root = relative(process.cwd(), config.webDistDir) || '.';
    app.use('/*', serveStatic({ root }));
    app.get('/*', serveStatic({ path: `${root}/index.html` }));
  }
  const runtimeApp = app as UnifiedApp;
  runtimeApp.stopBackgroundTasks = () => { for (const stop of stops.splice(0)) stop(); };
  return runtimeApp;

  async function withExecutor(c: any, fn: (accountId: string) => Promise<unknown>) {
    const body = await c.req.json().catch(() => ({})) as { executorAccountId?: string };
    if (!body.executorAccountId) return c.json({ ok: false, error: '缺少 executorAccountId' }, 400);
    return wrap(c, () => fn(body.executorAccountId!));
  }
}

async function wrapPublic(c: any, fn: () => Promise<unknown>) {
  try { return c.json({ ok: true, data: await fn() }); }
  catch (error) { return serviceErrorResponse(c, error); }
}

function serviceErrorResponse(c: any, error: unknown) {
  const serviceError = asServiceError(error);
  return c.json({
    ok: false,
    error: serviceError.message,
    ...(serviceError.upstreamStatus === undefined ? {} : { upstreamStatus: serviceError.upstreamStatus })
  }, serviceError.status as any);
}

function accountFilters(c: any): AccountListFilters {
  if (c.req.query('personalPlan') !== undefined) {
    throw new ServiceError(400, 'personalPlan 列表筛选已删除，请使用 primaryPlan');
  }
  return {
    ...(c.req.query('groupId') ? { groupId: c.req.query('groupId') } : {}),
    ...booleanQuery(c.req.query('hasManageableWorkspace'), 'hasManageableWorkspace'),
    ...booleanQuery(c.req.query('isWorkspaceMember'), 'isWorkspaceMember'),
    ...booleanQuery(c.req.query('hasWorkspaceCredential'), 'hasWorkspaceCredential'),
    ...booleanQuery(c.req.query('hasGamBinding'), 'hasGamBinding'),
    ...booleanQuery(c.req.query('hasSession'), 'hasSession'),
    ...booleanQuery(c.req.query('hasRunningProfile'), 'hasRunningProfile'),
    ...booleanQuery(c.req.query('isBanned'), 'isBanned'),
    ...(c.req.query('primaryPlan') ? { primaryPlan: c.req.query('primaryPlan') } : {}),
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
