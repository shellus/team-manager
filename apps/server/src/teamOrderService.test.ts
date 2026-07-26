import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { AccountStore } from './accountStore.js';
import { buildApp } from './app.js';
import type { AppConfig } from './config.js';
import type { TeamCodeGateway, TeamCodeOrderInput } from './teamCodeClient.js';
import { TeamOrderService, resolveTeamOrderConfig, workspaceNameForTeamOrder } from './teamOrderService.js';
import { TeamOrderStore } from './teamOrderStore.js';
import { TeamService } from './teamService.js';
import { SubaccountStore } from './subaccountStore.js';
import type { ApiResult, TeamOrderDashboardView, TeamOrderMaintenanceView } from '@team-manager/shared';

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

class FakeTeamCode implements TeamCodeGateway {
  readonly configured = true;
  readonly inputs: TeamCodeOrderInput[] = [];

  async generateOrder(input: TeamCodeOrderInput) {
    this.inputs.push(input);
    return {
      taskId: `task-${this.inputs.length}`,
      payUrl: `https://checkout.stripe.test/${this.inputs.length}`,
      stripeCreatedAt: 1_780_000_000_000,
      expiresAt: 1_780_086_400_000
    };
  }
}

async function setup(nowValue = 1_780_000_000_000) {
  tempDir = await mkdtemp(join(tmpdir(), 'team-order-service-'));
  const accounts = new AccountStore(tempDir);
  await accounts.init();
  const account = await accounts.add({
    remark: 'morgan seller',
    groupName: '默认分组',
    accountId: 'workspace-codex-1',
    email: 'owner@example.com',
    accessToken: 'access-token',
    sessionToken: 'session-token',
    planType: 'self_serve_business_usage_based',
    hasTeamSubscription: false,
    status: 'active'
  });
  const orders = new TeamOrderStore(tempDir);
  await orders.init();
  const team = new TeamService(accounts);
  const gateway = new FakeTeamCode();
  let now = nowValue;
  const service = new TeamOrderService(orders, accounts, team, gateway, () => now);
  await service.init();
  return { accounts, account, orders, gateway, service, setNow: (value: number) => { now = value; } };
}

async function eventually(check: () => boolean): Promise<void> {
  for (let i = 0; i < 30; i += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('等待异步订单任务完成超时');
}

describe('TeamOrderService', () => {
  it('resolves per-account overrides over persisted global config', () => {
    assert.deepEqual(
      resolveTeamOrderConfig(
        { promoCode: 'GLOBAL', country: 'US', currency: 'USD' },
        { country: 'gb', promoCode: '' }
      ),
      { promoCode: 'GLOBAL', country: 'GB', currency: 'USD' }
    );
  });

  it('uses the existing workspace name and falls back to the short-name Inc rule', () => {
    assert.equal(workspaceNameForTeamOrder({ workspaceName: 'Current Space' } as never), 'Current Space');
    assert.equal(
      workspaceNameForTeamOrder({ email: 'owner@example.com', remark: 'morgan seller' } as never),
      'Morgan Inc'
    );
  });

  it('joins explicitly, snapshots effective config, and keeps manual generation from shifting the automatic schedule', async () => {
    const { account, orders, gateway, service } = await setup();
    await service.updateGlobalConfig({ promoCode: 'GLOBAL', country: 'US', currency: 'USD' });
    const joined = await service.joinOrUpdate(account.id, { country: 'GB', currency: '' });
    const nextRunAt = joined.maintenance.nextRunAt;

    await service.generateNow(account.id);
    await eventually(() => (
      orders.listOrders(account.id)[0]?.status === 'ready'
      && orders.getMaintenance(account.id)?.lastSuccessAt !== undefined
    ));

    const ready = orders.listOrders(account.id)[0]!;
    assert.equal(ready.status, 'ready');
    assert.deepEqual(ready.config, { promoCode: 'GLOBAL', country: 'GB', currency: 'USD' });
    assert.equal(ready.workspaceId, 'workspace-codex-1');
    assert.equal(ready.workspaceName, 'Morgan Inc');
    assert.equal(ready.expiresAt, 1_780_086_400_000);
    assert.equal(gateway.inputs[0]?.account.id, account.id);
    assert.equal((await service.accountView(account.id))!.maintenance.nextRunAt, nextRunAt);
  });

  it('pauses maintenance when the account is confirmed as Team subscribed', async () => {
    const { accounts, account, service } = await setup();
    await service.joinOrUpdate(account.id, {});
    await accounts.update(account.id, { hasTeamSubscription: true });

    await service.tick();

    const view = await service.accountView(account.id);
    assert.equal(view?.maintenance.status, 'paused');
    assert.match(view?.maintenance.pauseReason ?? '', /Team 订阅/);
  });

  it('spreads generate-all jobs across a ten-minute window', async () => {
    const { accounts, account, orders, service } = await setup();
    const second = await accounts.add({
      groupName: '默认分组',
      accountId: 'workspace-codex-2',
      email: 'second@example.com',
      accessToken: 'access-token-2',
      planType: 'self_serve_business_usage_based',
      hasTeamSubscription: false,
      status: 'active'
    });
    await service.joinOrUpdate(account.id, {});
    await service.joinOrUpdate(second.id, {});

    const result = await service.generateAll();
    const batch = orders.listOrders().filter((order) => order.source === 'manual_all');

    assert.deepEqual(result, { queued: 2, skipped: 0 });
    assert.equal(batch.length, 2);
    assert.ok(batch.every((order) => order.scheduledFor >= 1_780_000_000_000));
    assert.ok(batch.every((order) => order.scheduledFor < 1_780_000_600_000));
  });

  it('resolves the current configuration when a spread batch job actually starts', async () => {
    const { account, orders, gateway, service, setNow } = await setup();
    await service.updateGlobalConfig({ promoCode: 'OLD', country: 'US', currency: 'USD' });
    await service.joinOrUpdate(account.id, {});
    await service.generateAll();
    const queued = orders.listOrders(account.id).find((order) => order.source === 'manual_all')!;
    assert.ok(queued.scheduledFor > 1_780_000_000_000);

    await service.updateGlobalConfig({ promoCode: 'CURRENT', country: 'CA', currency: 'CAD' });
    setNow(queued.scheduledFor);
    await service.tick();
    await eventually(() => (
      orders.getOrder(queued.id)?.status === 'ready'
      && orders.getMaintenance(account.id)?.lastSuccessAt === queued.scheduledFor
    ));

    assert.deepEqual(gateway.inputs[0]?.config, { promoCode: 'CURRENT', country: 'CA', currency: 'CAD' });
    assert.deepEqual(orders.getOrder(queued.id)?.config, { promoCode: 'CURRENT', country: 'CA', currency: 'CAD' });

    await service.setPaused(account.id, true);
    await eventually(() => orders.listOrders(account.id).every((order) => (
      order.status !== 'queued' && order.status !== 'running'
    )));
  });

  it('keeps a paused record paused while editing config and cancels its queued work', async () => {
    const { account, orders, service } = await setup();
    await service.joinOrUpdate(account.id, {});
    await service.generateAll();
    const queued = orders.listOrders(account.id)[0]!;

    await service.setPaused(account.id, true);
    await service.joinOrUpdate(account.id, { promoCode: 'PAUSED' });

    const view = await service.accountView(account.id);
    assert.equal(view?.maintenance.status, 'paused');
    assert.equal(view?.maintenance.overrides.promoCode, 'PAUSED');
    assert.equal(orders.getOrder(queued.id)?.status, 'failed');
    assert.match(orders.getOrder(queued.id)?.error ?? '', /排队任务已取消/);
  });

  it('expedites an automatic retry and creates a new task for a terminal failure', async () => {
    const { account, orders, service, setNow } = await setup();
    await service.joinOrUpdate(account.id, {});
    await service.generateAll();
    const original = orders.listOrders(account.id)[0]!;
    await orders.saveOrder({
      ...original,
      attemptCount: 3,
      retryAt: 1_780_000_600_000,
      error: 'temporary failure',
      updatedAt: 1_780_000_100_000
    });
    setNow(1_780_000_200_000);

    const expedited = await service.retryOrder(account.id, original.id);
    assert.equal(expedited.id, original.id);
    assert.equal(expedited.retryAt, 1_780_000_200_000);
    assert.equal(expedited.scheduledFor, 1_780_000_200_000);

    await eventually(() => (
      orders.getOrder(original.id)?.status === 'ready'
      && orders.getMaintenance(account.id)?.lastSuccessAt === 1_780_000_200_000
    ));
    await orders.saveOrder({
      ...orders.getOrder(original.id)!,
      status: 'failed',
      error: 'terminal failure',
      completedAt: 1_780_000_210_000,
      updatedAt: 1_780_000_210_000
    });
    setNow(1_780_000_220_000);

    const regenerated = await service.retryOrder(account.id, original.id);
    assert.notEqual(regenerated.id, original.id);
    assert.equal(regenerated.source, 'manual');
    assert.equal(regenerated.attemptCount, 0);
    await eventually(() => (
      orders.getOrder(regenerated.id)?.status === 'ready'
      && orders.getMaintenance(account.id)?.lastSuccessAt === 1_780_000_220_000
    ));
  });

  it('exposes authenticated maintenance APIs without leaking account credentials', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'team-order-api-'));
    const accounts = new AccountStore(tempDir);
    await accounts.init();
    const subaccounts = new SubaccountStore(tempDir);
    await subaccounts.init();
    const account = await accounts.add({
      groupName: '默认分组',
      accountId: 'workspace-api',
      email: 'api@example.com',
      accessToken: 'secret-access-token',
      sessionToken: 'secret-session-token',
      planType: 'self_serve_business_usage_based',
      hasTeamSubscription: false,
      status: 'active'
    });
    const config: AppConfig = {
      port: 0,
      dataDir: tempDir,
      jwtSecret: 'test-secret',
      jwtIssuer: 'team-manager',
      adminUsername: 'admin',
      apiToken: 'api-token',
      allowedOrigins: [],
      webDistDir: join(tempDir, 'dist')
    };
    const app = await buildApp({ config, store: accounts, subaccountStore: subaccounts, teamCodeGateway: new FakeTeamCode() });
    const headers = { Authorization: 'Bearer api-token', 'Content-Type': 'application/json' };

    const joinedResponse = await app.request(`/api/accounts/${account.id}/team-order-maintenance`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ promoCode: 'SAVE50', country: 'GB' })
    });
    const joined = await joinedResponse.json() as ApiResult<TeamOrderMaintenanceView>;
    assert.equal(joinedResponse.status, 200);
    assert.equal(joined.data?.effectiveConfig.promoCode, 'SAVE50');
    assert.equal(joined.data?.effectiveConfig.currency, 'USD');

    const dashboardResponse = await app.request('/api/team-orders', { headers });
    const dashboard = await dashboardResponse.json() as ApiResult<TeamOrderDashboardView>;
    assert.equal(dashboard.data?.items.length, 1);
    assert.equal(JSON.stringify(dashboard).includes('secret-access-token'), false);
    assert.equal(JSON.stringify(dashboard).includes('secret-session-token'), false);
  });
});
