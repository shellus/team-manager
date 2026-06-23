import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Account } from '@team-manager/shared';

type StoredAccount = Account & {
  memberCount?: unknown;
  chatgptSeatCount?: unknown;
  pendingInviteCount?: unknown;
};

const DEFAULT_ACCOUNT_GROUP = '默认分组';
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeMemberProfiles(input: Account['memberProfiles']): Account['memberProfiles'] | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;

  const profiles: NonNullable<Account['memberProfiles']> = {};
  for (const [key, rawProfile] of Object.entries(input)) {
    if (!rawProfile || typeof rawProfile !== 'object' || Array.isArray(rawProfile)) continue;
    const profile = rawProfile as unknown as Record<string, unknown>;
    const email = normalizeEmail(profile.email) || normalizeEmail(key);
    if (!email) continue;

    const expiresOn = typeof profile.expiresOn === 'string' && DATE_ONLY_PATTERN.test(profile.expiresOn)
      ? profile.expiresOn
      : undefined;
    if (!expiresOn) continue;

    const note = typeof profile.note === 'string' ? profile.note.trim() : '';
    const updatedAt = typeof profile.updatedAt === 'number' && Number.isFinite(profile.updatedAt)
      ? profile.updatedAt
      : Date.now();

    profiles[email] = {
      email,
      ...(note ? { note } : {}),
      expiresOn,
      expireRemove: typeof profile.expireRemove === 'boolean' ? profile.expireRemove : false,
      expireReminder: typeof profile.expireReminder === 'boolean' ? profile.expireReminder : true,
      updatedAt
    };
  }

  return Object.keys(profiles).length > 0 ? profiles : undefined;
}

function stripLegacyDerivedFields(input: StoredAccount): { account: Account; changed: boolean } {
  let changed =
    hasOwn(input, 'memberCount') || hasOwn(input, 'chatgptSeatCount') || hasOwn(input, 'pendingInviteCount');
  const {
    memberCount: _memberCount,
    chatgptSeatCount: _chatgptSeatCount,
    pendingInviteCount: _pendingInviteCount,
    ...account
  } = input;

  const email = account.email?.trim() ?? '';
  const label = account.label?.trim() ?? '';
  const note = account.note?.trim();
  const groupName = account.groupName?.trim() || DEFAULT_ACCOUNT_GROUP;
  const migratedNote = note || (label && email && label !== email ? label : undefined);
  const normalized: Account = {
    ...account,
    label: email || label,
    note: migratedNote,
    groupName,
    memberProfiles: normalizeMemberProfiles(account.memberProfiles)
  };
  changed =
    changed ||
    normalized.label !== account.label ||
    normalized.note !== account.note ||
    normalized.groupName !== account.groupName ||
    normalized.memberProfiles !== account.memberProfiles;
  return { account: normalized, changed };
}

/** 母号持久化：单个 JSON 文件 data/accounts.json，含凭证，仅后端读写。 */
export class AccountStore {
  private readonly file: string;
  private accounts = new Map<string, Account>();
  private loaded = false;

  constructor(private readonly dataDir: string) {
    this.file = join(dataDir, 'accounts.json');
  }

  async init(): Promise<void> {
    if (!existsSync(this.dataDir)) {
      await mkdir(this.dataDir, { recursive: true });
    }
    if (existsSync(this.file)) {
      try {
        const raw = await readFile(this.file, 'utf8');
        const arr = JSON.parse(raw) as StoredAccount[];
        let changed = false;
        for (const a of arr) {
          if (a && typeof a.id === 'string') {
            const sanitized = stripLegacyDerivedFields(a);
            changed = changed || sanitized.changed;
            this.accounts.set(sanitized.account.id, sanitized.account);
          }
        }
        if (changed) await this.persist();
      } catch (e) {
        throw new Error(`读取 accounts.json 失败: ${(e as Error).message}`);
      }
    }
    this.loaded = true;
  }

  private ensureLoaded() {
    if (!this.loaded) throw new Error('AccountStore 未 init()');
  }

  list(): Account[] {
    this.ensureLoaded();
    return [...this.accounts.values()];
  }

  get(id: string): Account | undefined {
    this.ensureLoaded();
    return this.accounts.get(id);
  }

  async add(input: Omit<Account, 'id'>): Promise<Account> {
    this.ensureLoaded();
    const { account } = stripLegacyDerivedFields({ ...input, id: randomUUID() });
    this.accounts.set(account.id, account);
    await this.persist();
    return account;
  }

  async update(id: string, patch: Partial<Account>): Promise<Account | undefined> {
    this.ensureLoaded();
    const existing = this.accounts.get(id);
    if (!existing) return undefined;
    const { account: merged } = stripLegacyDerivedFields({ ...existing, ...patch, id });
    this.accounts.set(id, merged);
    await this.persist();
    return merged;
  }

  async remove(id: string): Promise<boolean> {
    this.ensureLoaded();
    const ok = this.accounts.delete(id);
    if (ok) await this.persist();
    return ok;
  }

  private async persist(): Promise<void> {
    const arr = [...this.accounts.values()].map((account) => stripLegacyDerivedFields(account).account);
    await writeFile(this.file, JSON.stringify(arr, null, 2), 'utf8');
  }
}
