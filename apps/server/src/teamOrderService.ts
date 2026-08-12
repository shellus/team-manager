import { createHash, randomUUID } from 'node:crypto';
import type {
  Account,
  MaintainedTeamOrder,
  TeamOrderBatchResult,
  TeamOrderConfig,
  TeamOrderConfigOverrides,
  TeamOrderDashboardView,
  TeamOrderMaintenanceView
} from '@team-manager/shared';
import { CHECKOUT_COUNTRY_CODES, CHECKOUT_CURRENCIES } from '@team-manager/shared';
import { AccountStore } from './accountStore.js';
import type { TeamCodeGateway } from './teamCodeClient.js';
import { TeamOrderStore } from './teamOrderStore.js';
import { ServiceError, TeamService } from './teamService.js';

const CYCLE_MS = 8 * 60 * 60_000;
const DISTRIBUTION_MS = 10 * 60_000;
const RETRY_DELAYS_MS = [60_000, 3 * 60_000, 10 * 60_000] as const;
const MAX_ACTIVE_JOBS = 3;
const CODEX_SPACE_PLAN = 'self_serve_business_usage_based';
const COUNTRY_CODES = new Set<string>(CHECKOUT_COUNTRY_CODES);
const CURRENCIES = new Set<string>(CHECKOUT_CURRENCIES);

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stableOffset(key: string): number {
  const value = createHash('sha256').update(key).digest().readUInt32BE(0);
  return value % DISTRIBUTION_MS;
}

export function resolveTeamOrderConfig(
  globalConfig: TeamOrderConfig,
  overrides: TeamOrderConfigOverrides
): TeamOrderConfig {
  return {
    promoCode: text(overrides.promoCode) || globalConfig.promoCode,
    country: (text(overrides.country) || globalConfig.country).toUpperCase(),
    currency: (text(overrides.currency) || globalConfig.currency).toUpperCase()
  };
}

export function workspaceNameForTeamOrder(account: Account): string {
  if (text(account.workspaceName)) return text(account.workspaceName);
  const source = text(account.remark) || text(account.email).split('@')[0] || 'Workspace';
  const words = source.match(/[A-Za-z]{2,}/g) ?? [];
  const shortName = words[0] || 'Workspace';
  return `${shortName[0]!.toUpperCase()}${shortName.slice(1).toLowerCase()} Inc`;
}

function assertValidConfig(config: TeamOrderConfig): void {
  if (!config.country) throw new ServiceError(400, '订单国家不能为空');
  if (!config.currency) throw new ServiceError(400, '订单货币不能为空');
  if (!COUNTRY_CODES.has(config.country)) throw new ServiceError(400, `不支持的订单国家：${config.country}`);
  if (!CURRENCIES.has(config.currency)) throw new ServiceError(400, `不支持的订单货币：${config.currency}`);
}

export class TeamOrderService {
  private activeJobs = 0;
  private readonly activeAccounts = new Set<string>();
  private readonly activeTasks = new Set<Promise<void>>();
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly orderStore: TeamOrderStore,
    private readonly accountStore: AccountStore,
    private readonly teamService: TeamService,
    private readonly teamCode: TeamCodeGateway,
    private readonly now: () => number = Date.now
  ) {}

  async init(): Promise<void> {
    await this.orderStore.recoverInterruptedOrders(this.now());
  }

  start(): () => void {
    if (this.timer) return () => this.stop();
    void this.tick();
    this.timer = setInterval(() => void this.tick(), 15_000);
    this.timer.unref();
    return () => this.stop();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async waitForIdle(): Promise<void> {
    while (this.activeTasks.size > 0) {
      await Promise.allSettled([...this.activeTasks]);
    }
  }

  async dashboard(): Promise<TeamOrderDashboardView> {
    const globalConfig = this.orderStore.getGlobalConfig();
    const summaries = new Map((await this.teamService.listAccountSummaries()).map((account) => [account.id, account]));
    const items: TeamOrderMaintenanceView[] = [];
    for (const maintenance of this.orderStore.listMaintenances()) {
      const account = summaries.get(maintenance.accountId);
      if (!account) continue;
      items.push({
        account,
        maintenance,
        effectiveConfig: resolveTeamOrderConfig(globalConfig, maintenance.overrides),
        orders: this.orderStore.listOrders(maintenance.accountId)
      });
    }
    return { configured: this.teamCode.configured, globalConfig, items };
  }

  async accountView(accountId: string): Promise<TeamOrderMaintenanceView | null> {
    const maintenance = this.orderStore.getMaintenance(accountId);
    if (!maintenance) return null;
    const account = (await this.teamService.listAccountSummaries()).find((item) => item.id === accountId);
    if (!account) return null;
    return {
      account,
      maintenance,
      effectiveConfig: resolveTeamOrderConfig(this.orderStore.getGlobalConfig(), maintenance.overrides),
      orders: this.orderStore.listOrders(accountId)
    };
  }

  async updateGlobalConfig(input: Partial<TeamOrderConfig>): Promise<TeamOrderConfig> {
    const current = this.orderStore.getGlobalConfig();
    const config: TeamOrderConfig = {
      promoCode: input.promoCode === undefined ? current.promoCode : text(input.promoCode),
      country: (input.country === undefined ? current.country : text(input.country)).toUpperCase(),
      currency: (input.currency === undefined ? current.currency : text(input.currency)).toUpperCase()
    };
    assertValidConfig(config);
    return this.orderStore.setGlobalConfig(config);
  }

  async joinOrUpdate(accountId: string, input: TeamOrderConfigOverrides): Promise<TeamOrderMaintenanceView> {
    const account = this.accountStore.get(accountId);
    this.assertEligible(account);
    const now = this.now();
    const existing = this.orderStore.getMaintenance(accountId);
    const overrides: TeamOrderConfigOverrides = {
      ...(text(input.promoCode) ? { promoCode: text(input.promoCode) } : {}),
      ...(text(input.country) ? { country: text(input.country).toUpperCase() } : {}),
      ...(text(input.currency) ? { currency: text(input.currency).toUpperCase() } : {})
    };
    assertValidConfig(resolveTeamOrderConfig(this.orderStore.getGlobalConfig(), overrides));
    await this.orderStore.saveMaintenance({
      accountId,
      status: existing?.status ?? 'active',
      overrides,
      nextRunAt: existing?.nextRunAt ?? now + stableOffset(account.accountId),
      ...(existing?.pauseReason ? { pauseReason: existing.pauseReason } : {}),
      ...(existing?.lastSuccessAt ? { lastSuccessAt: existing.lastSuccessAt } : {}),
      ...(existing?.lastError ? { lastError: existing.lastError } : {}),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    });
    return (await this.accountView(accountId))!;
  }

  async setPaused(accountId: string, paused: boolean): Promise<TeamOrderMaintenanceView> {
    const existing = this.orderStore.getMaintenance(accountId);
    if (!existing) throw new ServiceError(404, '该母号尚未加入订单维护池');
    if (!paused) this.assertEligible(this.accountStore.get(accountId));
    if (paused) await this.orderStore.failQueuedOrders(accountId, '订单维护已暂停，排队任务已取消', this.now());
    await this.orderStore.updateMaintenance(accountId, {
      status: paused ? 'paused' : 'active',
      pauseReason: paused ? '手动暂停' : undefined,
      updatedAt: this.now()
    });
    return (await this.accountView(accountId))!;
  }

  async remove(accountId: string): Promise<boolean> {
    if (this.orderStore.listOrders(accountId).some((order) => order.status === 'running')) {
      throw new ServiceError(409, '该母号仍有执行中的订单，暂时不能移出维护池');
    }
    await this.orderStore.failQueuedOrders(accountId, '母号已移出订单维护池，排队任务已取消', this.now());
    const removed = await this.orderStore.removeMaintenance(accountId);
    if (!removed) throw new ServiceError(404, '该母号尚未加入订单维护池');
    return true;
  }

  async generateNow(accountId: string): Promise<MaintainedTeamOrder> {
    if (!this.teamCode.configured) throw new ServiceError(503, 'TeamCode 服务尚未配置');
    const maintenance = this.orderStore.getMaintenance(accountId);
    if (!maintenance) throw new ServiceError(404, '该母号尚未加入订单维护池');
    if (maintenance.status !== 'active') throw new ServiceError(409, '该母号的订单维护已暂停');
    if (this.hasPendingOrder(accountId)) throw new ServiceError(409, '该母号已有待执行订单');
    const order = await this.enqueue(accountId, 'manual', this.now());
    void this.tick();
    return order;
  }

  async retryOrder(accountId: string, orderId: string): Promise<MaintainedTeamOrder> {
    if (!this.teamCode.configured) throw new ServiceError(503, 'TeamCode 服务尚未配置');
    const maintenance = this.orderStore.getMaintenance(accountId);
    if (!maintenance) throw new ServiceError(404, '该母号尚未加入订单维护池');
    if (maintenance.status !== 'active') throw new ServiceError(409, '该母号的订单维护已暂停');
    this.assertEligible(this.accountStore.get(accountId));

    const order = this.orderStore.getOrder(orderId);
    if (!order || order.accountId !== accountId) throw new ServiceError(404, '订单记录不存在');
    const hasOtherPending = this.orderStore.listOrders(accountId).some((item) => (
      item.id !== orderId && (item.status === 'queued' || item.status === 'running')
    ));
    if (hasOtherPending) throw new ServiceError(409, '该母号已有其他待执行订单');

    const now = this.now();
    if (order.status === 'queued' && order.attemptCount > 0 && order.retryAt) {
      const expedited = await this.orderStore.saveOrder({
        ...order,
        scheduledFor: now,
        retryAt: now,
        updatedAt: now
      });
      void this.tick();
      return expedited;
    }
    if (order.status === 'failed') {
      const retried = await this.enqueue(accountId, 'manual', now);
      void this.tick();
      return retried;
    }
    if (order.status === 'running') throw new ServiceError(409, '该订单正在生成，无需重复重试');
    if (order.status === 'queued') throw new ServiceError(409, '该订单已经在等待首次生成');
    throw new ServiceError(409, '该订单当前不需要重试');
  }

  async generateAll(): Promise<TeamOrderBatchResult> {
    if (!this.teamCode.configured) throw new ServiceError(503, 'TeamCode 服务尚未配置');
    const now = this.now();
    let queued = 0;
    let skipped = 0;
    for (const maintenance of this.orderStore.listMaintenances()) {
      if (maintenance.status !== 'active' || this.hasPendingOrder(maintenance.accountId)) {
        skipped += 1;
        continue;
      }
      const account = this.accountStore.get(maintenance.accountId);
      if (!account || this.teamService.hasTeamSubscription(maintenance.accountId)) {
        skipped += 1;
        continue;
      }
      await this.enqueue(maintenance.accountId, 'manual_all', now + stableOffset(account.accountId));
      queued += 1;
    }
    void this.tick();
    return { queued, skipped };
  }

  async tick(): Promise<void> {
    const now = this.now();
    await this.pauseCompletedSubscriptions(now);
    if (!this.teamCode.configured) return;
    for (const maintenance of this.orderStore.listMaintenances()) {
      if (maintenance.status !== 'active' || maintenance.nextRunAt > now || this.hasPendingOrder(maintenance.accountId)) continue;
      const account = this.accountStore.get(maintenance.accountId);
      if (!account) continue;
      try {
        this.assertEligible(account);
        await this.enqueue(maintenance.accountId, 'scheduled', now);
        const cyclesBehind = Math.max(1, Math.floor((now - maintenance.nextRunAt) / CYCLE_MS) + 1);
        await this.orderStore.updateMaintenance(maintenance.accountId, {
          nextRunAt: maintenance.nextRunAt + cyclesBehind * CYCLE_MS,
          updatedAt: now
        });
      } catch (error) {
        await this.orderStore.failQueuedOrders(maintenance.accountId, '订单维护已自动暂停，排队任务已取消', now);
        await this.orderStore.updateMaintenance(maintenance.accountId, {
          status: 'paused',
          pauseReason: (error as Error).message,
          lastError: (error as Error).message,
          updatedAt: now
        });
      }
    }

    const due = this.orderStore.listOrders()
      .filter((order) => (
        order.status === 'queued'
        && this.orderStore.getMaintenance(order.accountId)?.status === 'active'
        && order.scheduledFor <= now
        && (!order.retryAt || order.retryAt <= now)
      ))
      .sort((a, b) => a.scheduledFor - b.scheduledFor);
    for (const order of due) {
      if (this.activeJobs >= MAX_ACTIVE_JOBS) break;
      if (this.activeAccounts.has(order.accountId)) continue;
      this.activeJobs += 1;
      this.activeAccounts.add(order.accountId);
      const task = this.runOrder(order).finally(async () => {
        this.activeJobs -= 1;
        this.activeAccounts.delete(order.accountId);
        await this.tick();
      });
      this.activeTasks.add(task);
      void task.finally(() => this.activeTasks.delete(task));
    }
  }

  private assertEligible(account: Account | undefined): asserts account is Account {
    if (!account) throw new ServiceError(404, '母号不存在');
    if (!account.accountId.trim() || account.planType !== CODEX_SPACE_PLAN) {
      throw new ServiceError(409, '只有已开通 Codex Workspace 的母号可以加入订单维护池');
    }
    if (this.teamService.hasTeamSubscription(account.id)) {
      throw new ServiceError(409, '该母号已经开通 Team，不能生成升级订单');
    }
    if (!account.accessToken.trim()) throw new ServiceError(409, '母号缺少可用 Web accessToken');
  }

  private hasPendingOrder(accountId: string): boolean {
    return this.orderStore.listOrders(accountId).some((order) => order.status === 'queued' || order.status === 'running');
  }

  private async enqueue(
    accountId: string,
    source: MaintainedTeamOrder['source'],
    scheduledFor: number
  ): Promise<MaintainedTeamOrder> {
    const account = this.accountStore.get(accountId);
    this.assertEligible(account);
    const maintenance = this.orderStore.getMaintenance(accountId);
    if (!maintenance) throw new ServiceError(404, '该母号尚未加入订单维护池');
    const config = resolveTeamOrderConfig(this.orderStore.getGlobalConfig(), maintenance.overrides);
    assertValidConfig(config);
    const now = this.now();
    return this.orderStore.saveOrder({
      id: randomUUID(),
      accountId,
      source,
      status: 'queued',
      scheduledFor,
      workspaceId: account.accountId,
      workspaceName: workspaceNameForTeamOrder(account),
      config,
      attemptCount: 0,
      createdAt: now,
      updatedAt: now
    });
  }

  private async runOrder(order: MaintainedTeamOrder): Promise<void> {
    const now = this.now();
    let running = await this.orderStore.saveOrder({
      ...order,
      status: 'running',
      attemptCount: order.attemptCount + 1,
      retryAt: undefined,
      error: undefined,
      updatedAt: now
    });
    const account = this.accountStore.get(order.accountId);
    try {
      this.assertEligible(account);
      if (running.attemptCount === 1) {
        const maintenance = this.orderStore.getMaintenance(order.accountId);
        if (!maintenance) throw new ServiceError(404, '该母号尚未加入订单维护池');
        const config = resolveTeamOrderConfig(this.orderStore.getGlobalConfig(), maintenance.overrides);
        assertValidConfig(config);
        running = await this.orderStore.saveOrder({
          ...running,
          workspaceId: account.accountId,
          workspaceName: workspaceNameForTeamOrder(account),
          config,
          updatedAt: this.now()
        });
      }
      const result = await this.teamCode.generateOrder({
        account,
        workspaceName: running.workspaceName,
        config: running.config
      });
      const completedAt = this.now();
      await this.orderStore.saveOrder({
        ...running,
        status: 'ready',
        taskId: result.taskId,
        payUrl: result.payUrl,
        stripeCreatedAt: result.stripeCreatedAt,
        expiresAt: result.expiresAt,
        updatedAt: completedAt,
        completedAt
      });
      const maintenance = this.orderStore.getMaintenance(order.accountId);
      if (maintenance) {
        await this.orderStore.updateMaintenance(order.accountId, {
          lastSuccessAt: completedAt,
          lastError: undefined,
          updatedAt: completedAt
        });
      }
    } catch (error) {
      const failedAt = this.now();
      const message = (error as Error).message || String(error);
      const retryDelay = RETRY_DELAYS_MS[running.attemptCount - 1];
      await this.orderStore.saveOrder({
        ...running,
        status: retryDelay ? 'queued' : 'failed',
        ...(retryDelay ? { retryAt: failedAt + retryDelay } : { completedAt: failedAt }),
        error: message,
        updatedAt: failedAt
      });
      const maintenance = this.orderStore.getMaintenance(order.accountId);
      if (maintenance) {
        await this.orderStore.updateMaintenance(order.accountId, {
          lastError: message,
          updatedAt: failedAt
        });
      }
    }
  }

  private async pauseCompletedSubscriptions(now: number): Promise<void> {
    for (const maintenance of this.orderStore.listMaintenances()) {
      if (maintenance.status !== 'active') continue;
      const account = this.accountStore.get(maintenance.accountId);
      if (!account || !this.teamService.hasTeamSubscription(maintenance.accountId)) continue;
      await this.orderStore.failQueuedOrders(maintenance.accountId, '已检测到 Team 订阅，排队任务已取消', now);
      await this.orderStore.updateMaintenance(maintenance.accountId, {
        status: 'paused',
        pauseReason: '已检测到 Team 订阅，自动暂停订单维护',
        updatedAt: now
      });
    }
  }
}
