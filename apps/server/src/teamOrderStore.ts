import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MaintainedTeamOrder, TeamOrderConfig, TeamOrderMaintenance } from '@team-manager/shared';
import { ensurePrivateDirectory, ensurePrivateFile, writePrivateFile } from './privateDataFile.js';

interface TeamOrderData {
  globalConfig: TeamOrderConfig;
  maintenances: TeamOrderMaintenance[];
  orders: MaintainedTeamOrder[];
}

const DEFAULT_CONFIG: TeamOrderConfig = { promoCode: '', country: 'US', currency: 'USD' };
const ORDER_STATUSES = new Set(['queued', 'running', 'ready', 'failed']);
const ORDER_SOURCES = new Set(['scheduled', 'manual', 'manual_all']);

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function finite(value: unknown, fallback = Date.now()): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function optionalFinite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeConfig(value: unknown, fallback = DEFAULT_CONFIG): TeamOrderConfig {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    promoCode: Object.hasOwn(raw, 'promoCode') ? text(raw.promoCode) : fallback.promoCode,
    country: (Object.hasOwn(raw, 'country') ? text(raw.country) : fallback.country).toUpperCase(),
    currency: (Object.hasOwn(raw, 'currency') ? text(raw.currency) : fallback.currency).toUpperCase()
  };
}

function normalizeMaintenance(value: unknown): TeamOrderMaintenance | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const accountId = text(raw.accountId);
  if (!accountId) return undefined;
  const overridesRaw = raw.overrides && typeof raw.overrides === 'object' && !Array.isArray(raw.overrides)
    ? raw.overrides as Record<string, unknown>
    : {};
  const overrides = {
    ...(text(overridesRaw.promoCode) ? { promoCode: text(overridesRaw.promoCode) } : {}),
    ...(text(overridesRaw.country) ? { country: text(overridesRaw.country).toUpperCase() } : {}),
    ...(text(overridesRaw.currency) ? { currency: text(overridesRaw.currency).toUpperCase() } : {})
  };
  const createdAt = finite(raw.createdAt);
  const lastSuccessAt = optionalFinite(raw.lastSuccessAt);
  return {
    accountId,
    status: raw.status === 'paused' ? 'paused' : 'active',
    overrides,
    nextRunAt: finite(raw.nextRunAt),
    ...(text(raw.pauseReason) ? { pauseReason: text(raw.pauseReason) } : {}),
    ...(lastSuccessAt !== undefined ? { lastSuccessAt } : {}),
    ...(text(raw.lastError) ? { lastError: text(raw.lastError) } : {}),
    createdAt,
    updatedAt: finite(raw.updatedAt, createdAt)
  };
}

function normalizeOrder(value: unknown): MaintainedTeamOrder | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const id = text(raw.id);
  const accountId = text(raw.accountId);
  const status = text(raw.status);
  const source = text(raw.source);
  if (!id || !accountId || !ORDER_STATUSES.has(status) || !ORDER_SOURCES.has(source)) return undefined;
  const createdAt = finite(raw.createdAt);
  const stripeCreatedAt = optionalFinite(raw.stripeCreatedAt);
  const expiresAt = optionalFinite(raw.expiresAt);
  const retryAt = optionalFinite(raw.retryAt);
  const completedAt = optionalFinite(raw.completedAt);
  return {
    id,
    accountId,
    source: source as MaintainedTeamOrder['source'],
    status: status as MaintainedTeamOrder['status'],
    scheduledFor: finite(raw.scheduledFor, createdAt),
    workspaceId: text(raw.workspaceId),
    workspaceName: text(raw.workspaceName),
    config: normalizeConfig(raw.config),
    attemptCount: Math.max(0, Math.floor(finite(raw.attemptCount, 0))),
    ...(text(raw.taskId) ? { taskId: text(raw.taskId) } : {}),
    ...(text(raw.payUrl) ? { payUrl: text(raw.payUrl) } : {}),
    ...(stripeCreatedAt !== undefined ? { stripeCreatedAt } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    ...(retryAt !== undefined ? { retryAt } : {}),
    ...(text(raw.error) ? { error: text(raw.error) } : {}),
    createdAt,
    updatedAt: finite(raw.updatedAt, createdAt),
    ...(completedAt !== undefined ? { completedAt } : {})
  };
}

export class TeamOrderStore {
  private readonly file: string;
  private data: TeamOrderData = { globalConfig: { ...DEFAULT_CONFIG }, maintenances: [], orders: [] };
  private loaded = false;
  private persistChain = Promise.resolve();

  constructor(private readonly dataDir: string) {
    this.file = join(dataDir, 'team-orders.json');
  }

  async init(): Promise<void> {
    if (this.loaded) return;
    await ensurePrivateDirectory(this.dataDir);
    if (existsSync(this.file)) {
      await ensurePrivateFile(this.file);
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as Record<string, unknown>;
      this.data = {
        globalConfig: normalizeConfig(raw.globalConfig),
        maintenances: Array.isArray(raw.maintenances)
          ? raw.maintenances.map(normalizeMaintenance).filter((item): item is TeamOrderMaintenance => Boolean(item))
          : [],
        orders: Array.isArray(raw.orders)
          ? raw.orders.map(normalizeOrder).filter((item): item is MaintainedTeamOrder => Boolean(item))
          : []
      };
    }
    this.loaded = true;
  }

  private ensureLoaded(): void {
    if (!this.loaded) throw new Error('TeamOrderStore 未 init()');
  }

  getGlobalConfig(): TeamOrderConfig {
    this.ensureLoaded();
    return { ...this.data.globalConfig };
  }

  listMaintenances(): TeamOrderMaintenance[] {
    this.ensureLoaded();
    return this.data.maintenances.map((item) => ({ ...item, overrides: { ...item.overrides } }));
  }

  getMaintenance(accountId: string): TeamOrderMaintenance | undefined {
    return this.listMaintenances().find((item) => item.accountId === accountId);
  }

  listOrders(accountId?: string): MaintainedTeamOrder[] {
    this.ensureLoaded();
    return this.data.orders
      .filter((item) => !accountId || item.accountId === accountId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((item) => ({ ...item, config: { ...item.config } }));
  }

  getOrder(id: string): MaintainedTeamOrder | undefined {
    return this.listOrders().find((item) => item.id === id);
  }

  async setGlobalConfig(config: TeamOrderConfig): Promise<TeamOrderConfig> {
    this.data.globalConfig = normalizeConfig(config);
    await this.persist();
    return this.getGlobalConfig();
  }

  async saveMaintenance(maintenance: TeamOrderMaintenance): Promise<TeamOrderMaintenance> {
    const index = this.data.maintenances.findIndex((item) => item.accountId === maintenance.accountId);
    if (index >= 0) this.data.maintenances[index] = maintenance;
    else this.data.maintenances.push(maintenance);
    await this.persist();
    return this.getMaintenance(maintenance.accountId)!;
  }

  async updateMaintenance(
    accountId: string,
    patch: Partial<Omit<TeamOrderMaintenance, 'accountId' | 'createdAt'>>
  ): Promise<TeamOrderMaintenance | undefined> {
    const index = this.data.maintenances.findIndex((item) => item.accountId === accountId);
    if (index < 0) return undefined;
    const existing = this.data.maintenances[index]!;
    this.data.maintenances[index] = {
      ...existing,
      ...patch,
      accountId,
      createdAt: existing.createdAt,
      overrides: patch.overrides ? { ...patch.overrides } : existing.overrides
    };
    await this.persist();
    return this.getMaintenance(accountId);
  }

  async removeMaintenance(accountId: string): Promise<boolean> {
    const before = this.data.maintenances.length;
    this.data.maintenances = this.data.maintenances.filter((item) => item.accountId !== accountId);
    const changed = this.data.maintenances.length !== before;
    if (changed) await this.persist();
    return changed;
  }

  async saveOrder(order: MaintainedTeamOrder): Promise<MaintainedTeamOrder> {
    const index = this.data.orders.findIndex((item) => item.id === order.id);
    if (index >= 0) this.data.orders[index] = order;
    else this.data.orders.push(order);
    const keep = new Set<string>();
    for (const maintenance of this.data.maintenances) {
      this.data.orders
        .filter((item) => item.accountId === maintenance.accountId)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 30)
        .forEach((item) => keep.add(item.id));
    }
    this.data.orders = this.data.orders.filter((item) => keep.has(item.id));
    await this.persist();
    return this.getOrder(order.id)!;
  }

  async failQueuedOrders(accountId: string, reason: string, now = Date.now()): Promise<number> {
    let changed = 0;
    this.data.orders = this.data.orders.map((order) => {
      if (order.accountId !== accountId || order.status !== 'queued') return order;
      changed += 1;
      return {
        ...order,
        status: 'failed',
        error: reason,
        retryAt: undefined,
        updatedAt: now,
        completedAt: now
      };
    });
    if (changed) await this.persist();
    return changed;
  }

  async recoverInterruptedOrders(now = Date.now()): Promise<void> {
    let changed = false;
    this.data.orders = this.data.orders.map((order) => {
      if (order.status !== 'running') return order;
      changed = true;
      return {
        ...order,
        status: 'failed',
        error: 'Team Manager 重启，无法继续跟踪 TeamCode 内存任务',
        updatedAt: now,
        completedAt: now
      };
    });
    if (changed) await this.persist();
  }

  private async persist(): Promise<void> {
    this.ensureLoaded();
    const body = JSON.stringify(this.data, null, 2);
    this.persistChain = this.persistChain.then(() => writePrivateFile(this.file, body));
    await this.persistChain;
  }
}
