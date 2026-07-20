import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AccountBillingSnapshot } from '@team-manager/shared';
import { ensurePrivateDirectory, ensurePrivateFile, writePrivateFile } from './privateDataFile.js';

type BillingSnapshotMap = Record<string, AccountBillingSnapshot>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeSnapshot(input: unknown): AccountBillingSnapshot | undefined {
  if (!isRecord(input) || !isRecord(input.raw)) return undefined;
  if (typeof input.accountId !== 'string' || !input.accountId.trim()) return undefined;
  if (typeof input.workspaceAccountId !== 'string' || !input.workspaceAccountId.trim()) return undefined;
  if (typeof input.refreshedAt !== 'number' || !Number.isFinite(input.refreshedAt)) return undefined;
  return {
    accountId: input.accountId,
    workspaceAccountId: input.workspaceAccountId,
    refreshedAt: input.refreshedAt,
    raw: {
      invoices: input.raw.invoices,
      upcomingInvoice: input.raw.upcomingInvoice,
      paymentMethods: input.raw.paymentMethods,
      billingInfo: input.raw.billingInfo,
      seatTypeCounts: input.raw.seatTypeCounts
    }
  };
}

export class AccountBillingStore {
  private readonly file: string;
  private snapshots: BillingSnapshotMap = {};
  private loaded = false;

  constructor(private readonly dataDir: string) {
    this.file = join(dataDir, 'account-billing-snapshots.json');
  }

  async init(): Promise<void> {
    await ensurePrivateDirectory(this.dataDir);
    if (existsSync(this.file)) {
      await ensurePrivateFile(this.file);
      try {
        const raw = await readFile(this.file, 'utf8');
        const parsed = JSON.parse(raw) as unknown;
        if (isRecord(parsed)) {
          for (const [accountId, snapshot] of Object.entries(parsed)) {
            const normalized = normalizeSnapshot(snapshot);
            if (normalized) this.snapshots[accountId] = normalized;
          }
        }
      } catch (e) {
        throw new Error(`读取 account-billing-snapshots.json 失败: ${(e as Error).message}`);
      }
    }
    this.loaded = true;
  }

  get(accountId: string): AccountBillingSnapshot | undefined {
    this.ensureLoaded();
    return this.snapshots[accountId];
  }

  async save(snapshot: AccountBillingSnapshot): Promise<AccountBillingSnapshot> {
    this.ensureLoaded();
    this.snapshots[snapshot.accountId] = snapshot;
    await this.persist();
    return snapshot;
  }

  private ensureLoaded(): void {
    if (!this.loaded) throw new Error('AccountBillingStore 未 init()');
  }

  private async persist(): Promise<void> {
    await writePrivateFile(this.file, JSON.stringify(this.snapshots, null, 2));
  }
}
