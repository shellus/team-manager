import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  parseChatGptSessionInput,
  type ChatGptSessionInput,
  type CodexCredentialJson,
  type CodexQuotaSnapshot,
  type Subaccount,
  type SubaccountAuthLog,
  type SubaccountCodexCredential,
  type SubaccountTeamLink,
  type SubaccountView
} from '@team-manager/shared';

export interface AppendSubaccountLogInput {
  phase: string;
  status: string;
  message: string;
  data?: Record<string, unknown>;
}

type LegacySubaccountCodexCredential = SubaccountCodexCredential & {
  accountId?: unknown;
  credential?: CodexCredentialJson;
};

type LegacySubaccountTeamLink = SubaccountTeamLink & {
  accountLabel?: unknown;
  chatgptAccountId?: unknown;
};

type LegacySubaccount = Subaccount & {
  codexCredential?: CodexCredentialJson;
  codexCredentials?: LegacySubaccountCodexCredential[];
  teamLinks?: LegacySubaccountTeamLink[];
  lastQuota?: CodexQuotaSnapshot;
  lastQuotaAt?: number;
  lastAuthAt?: number;
};

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function codexCredentialAccountId(item: SubaccountCodexCredential): string {
  return item.accountId.trim();
}

const DEFAULT_CREDENTIAL_GROUP = '默认号池';
const CREDENTIAL_DIR = 'subaccount-credentials';

function normalizeGroupName(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_CREDENTIAL_GROUP;
}

function slug(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || 'credential';
}

function normalizeCredentialFileName(input: unknown, email: string, accountId: string): string {
  const raw = typeof input === 'string' ? input.trim() : '';
  const fallback = `${slug(email)}-${slug(accountId)}.json`;
  const candidate = raw ? basename(raw.replace(/\\/g, '/')) : fallback;
  const safe = candidate.replace(/[\0/\\]/g, '_').replace(/^\.+/, '').trim() || fallback;
  return safe.endsWith('.json') ? safe : `${safe}.json`;
}

/** 子号持久化：敏感 session / Codex 凭证仅存在运行时 data/，API 默认只返回脱敏视图。 */
export class SubaccountStore {
  private readonly file: string;
  private readonly logFile: string;
  private subaccounts = new Map<string, Subaccount>();
  private logs: SubaccountAuthLog[] = [];
  private loaded = false;

  constructor(private readonly dataDir: string) {
    this.file = join(dataDir, 'subaccounts.json');
    this.logFile = join(dataDir, 'subaccount-auth-logs.jsonl');
  }

  async init(): Promise<void> {
    if (!existsSync(this.dataDir)) {
      await mkdir(this.dataDir, { recursive: true });
    }
    await this.loadSubaccounts();
    await this.loadLogs();
    this.loaded = true;
  }

  private async loadSubaccounts(): Promise<void> {
    if (!existsSync(this.file)) return;
    try {
      const raw = await readFile(this.file, 'utf8');
      const arr = JSON.parse(raw) as unknown[];
      let changed = false;
      for (const rawAccount of arr) {
        const normalized = await normalizeStoredSubaccount(rawAccount, this.dataDir);
        if (normalized?.account.id) {
          changed = changed || normalized.changed;
          this.subaccounts.set(normalized.account.id, normalized.account);
        }
      }
      if (changed) await this.persist();
    } catch (e) {
      throw new Error(`读取 subaccounts.json 失败: ${(e as Error).message}`);
    }
  }

  private async loadLogs(): Promise<void> {
    if (!existsSync(this.logFile)) return;
    try {
      const raw = await readFile(this.logFile, 'utf8');
      this.logs = raw
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as SubaccountAuthLog)
        .filter((log) => Boolean(log.id));
    } catch (e) {
      throw new Error(`读取 subaccount-auth-logs.jsonl 失败: ${(e as Error).message}`);
    }
  }

  private ensureLoaded(): void {
    if (!this.loaded) throw new Error('SubaccountStore 未 init()');
  }

  list(): SubaccountView[] {
    this.ensureLoaded();
    return [...this.subaccounts.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((account) => this.toView(account));
  }

  get(id: string): Subaccount | undefined {
    this.ensureLoaded();
    return this.subaccounts.get(id);
  }

  getCodexCredential(id: string): CodexCredentialJson | undefined {
    this.ensureLoaded();
    const account = this.subaccounts.get(id);
    const credential = this.getLatestCodexCredential(account);
    return credential ? this.readCodexCredential(account!, credential) : undefined;
  }

  getCodexCredentialForAccount(id: string, accountId: string): CodexCredentialJson | undefined {
    this.ensureLoaded();
    const account = this.subaccounts.get(id);
    const credential = this.findCodexCredential(account, accountId);
    return account && credential ? this.readCodexCredential(account, credential) : undefined;
  }

  async importSession(raw: unknown): Promise<SubaccountView> {
    this.ensureLoaded();
    const session = parseChatGptSessionInput(raw);
    if ('error' in session) throw new Error(session.error);

    const now = Date.now();
    const existing = this.findByEmail(session.user.email);
    const next: Subaccount = {
      id: existing?.id ?? randomUUID(),
      email: session.user.email,
      label: existing?.label ?? session.user.email,
      chatgptAccountId: session.account.id,
      webAccessToken: session.accessToken,
      codexCredentials: existing?.codexCredentials,
      teamLinks: existing?.teamLinks,
      status: existing?.codexCredentials?.length ? 'codex_ready' : 'session_ready',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastError: undefined
    };

    this.subaccounts.set(next.id, next);
    await this.persist();
    return this.toView(next);
  }

  async importCodexCredential(
    credential: CodexCredentialJson,
    options: { fileName?: unknown; groupName?: unknown } = {}
  ): Promise<SubaccountView> {
    this.ensureLoaded();
    const email = credential.email.trim();
    const accountId = credential.account_id.trim();
    if (!email) throw new Error('Codex 凭证缺少 email');
    if (!accountId) throw new Error('Codex 凭证缺少 account_id');

    const now = Date.now();
    const existing = this.findByEmail(email);
    const id = existing?.id ?? randomUUID();
    const fileName = normalizeCredentialFileName(options.fileName, email, accountId);
    await this.writeCodexCredential(id, fileName, { ...credential, email, account_id: accountId });
    const credentials = upsertCodexCredential(existing?.codexCredentials ?? [], {
      accountId,
      fileName,
      groupName: normalizeGroupName(options.groupName),
      planType: credential.plan_type,
      lastAuthAt: now
    });
    const next: Subaccount = {
      id,
      email,
      label: existing?.label ?? email,
      chatgptAccountId: existing?.chatgptAccountId,
      webAccessToken: existing?.webAccessToken,
      codexCredentials: credentials,
      teamLinks: existing?.teamLinks,
      status: 'codex_ready',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastError: undefined
    };

    this.subaccounts.set(next.id, next);
    await this.persist();
    return this.toView(next);
  }

  async saveRegisteredSubaccount(input: {
    email: string;
    password: string;
    source?: string;
    status?: Subaccount['status'];
    lastError?: string;
  }): Promise<SubaccountView> {
    this.ensureLoaded();
    const email = input.email.trim();
    if (!email) throw new Error('注册结果缺少 email');
    if (!input.password.trim()) throw new Error('注册结果缺少 password');

    const now = Date.now();
    const existing = this.findByEmail(email);
    const next: Subaccount = {
      id: existing?.id ?? randomUUID(),
      email,
      label: existing?.label ?? email,
      chatgptAccountId: existing?.chatgptAccountId,
      webAccessToken: existing?.webAccessToken,
      registrationPassword: input.password,
      registeredAt: existing?.registeredAt ?? now,
      registrationSource: input.source,
      codexCredentials: existing?.codexCredentials,
      teamLinks: existing?.teamLinks,
      status: input.status ?? (existing?.codexCredentials?.length ? 'codex_ready' : 'session_ready'),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastError: input.lastError
    };

    this.subaccounts.set(next.id, next);
    await this.persist();
    return this.toView(next);
  }

  async updateLocalProfile(
    id: string,
    input: { label: string; session?: ChatGptSessionInput }
  ): Promise<SubaccountView | undefined> {
    this.ensureLoaded();
    const existing = this.subaccounts.get(id);
    if (!existing) return undefined;
    const credentials = existing.codexCredentials ?? [];
    const merged: Subaccount = {
      ...existing,
      label: input.label,
      email: input.session?.user.email ?? existing.email,
      chatgptAccountId: input.session?.account.id ?? existing.chatgptAccountId,
      webAccessToken: input.session?.accessToken ?? existing.webAccessToken,
      status: credentials.length ? 'codex_ready' : 'session_ready',
      updatedAt: Date.now(),
      lastError: undefined
    };
    this.subaccounts.set(id, merged);
    await this.persist();
    return this.toView(merged);
  }

  async update(id: string, patch: Partial<Subaccount>): Promise<SubaccountView | undefined> {
    this.ensureLoaded();
    const existing = this.subaccounts.get(id);
    if (!existing) return undefined;
    const merged: Subaccount = { ...existing, ...patch, id, updatedAt: Date.now() };
    this.subaccounts.set(id, merged);
    await this.persist();
    return this.toView(merged);
  }

  async saveCodexCredential(id: string, credential: CodexCredentialJson): Promise<SubaccountView | undefined> {
    this.ensureLoaded();
    const existing = this.subaccounts.get(id);
    if (!existing) return undefined;
    const now = Date.now();
    const accountId = credential.account_id.trim();
    if (!accountId) throw new Error('Codex 凭证缺少 account_id');
    const existingMeta = this.findCodexCredential(existing, accountId);
    const fileName = existingMeta?.fileName ?? normalizeCredentialFileName(undefined, credential.email || existing.email, accountId);
    await this.writeCodexCredential(id, fileName, credential);
    const credentials = upsertCodexCredential(existing.codexCredentials ?? [], {
      accountId,
      fileName,
      groupName: existingMeta?.groupName ?? DEFAULT_CREDENTIAL_GROUP,
      planType: credential.plan_type,
      lastAuthAt: now
    });
    const merged: Subaccount = {
      ...existing,
      email: credential.email || existing.email,
      label: existing.label || credential.email || existing.email,
      codexCredentials: credentials,
      status: 'codex_ready',
      updatedAt: now,
      lastError: undefined
    };
    this.subaccounts.set(id, merged);
    await this.persist();
    return this.toView(merged);
  }

  async saveTeamLink(id: string, link: Omit<SubaccountTeamLink, 'updatedAt'>): Promise<SubaccountView | undefined> {
    this.ensureLoaded();
    const existing = this.subaccounts.get(id);
    if (!existing) return undefined;
    const now = Date.now();
    const links = [
      ...(existing.teamLinks ?? []).filter((item) => item.accountId !== link.accountId),
      { ...link, updatedAt: now }
    ];
    const merged: Subaccount = {
      ...existing,
      teamLinks: links,
      updatedAt: now,
      lastError: undefined
    };
    this.subaccounts.set(id, merged);
    await this.persist();
    return this.toView(merged);
  }

  async saveQuotaSnapshot(id: string, accountId: string, snapshot: CodexQuotaSnapshot): Promise<SubaccountView | undefined> {
    this.ensureLoaded();
    const existing = this.subaccounts.get(id);
    if (!existing) return undefined;
    const credential = this.findCodexCredential(existing, accountId);
    if (!credential) throw new Error(`子号没有该 Team 的 Codex 凭证: ${accountId}`);
    const now = Date.now();
    const credentials = (existing.codexCredentials ?? []).map((item) => {
      if (codexCredentialAccountId(item) !== accountId) return item;
      const hasQuotaWindows = snapshot.windows.length > 0;
      if (!hasQuotaWindows && item.lastQuota?.windows.length) return item;
      return { ...item, lastQuota: snapshot, lastQuotaAt: now };
    });
    const merged: Subaccount = {
      ...existing,
      codexCredentials: credentials,
      updatedAt: now,
      status: snapshot.status === 'error' ? existing.status : credentials.length ? 'codex_ready' : existing.status,
      lastError: snapshot.status === 'error' ? existing.lastError : undefined
    };
    this.subaccounts.set(id, merged);
    await this.persist();
    return this.toView(merged);
  }

  async remove(id: string): Promise<boolean> {
    this.ensureLoaded();
    const ok = this.subaccounts.delete(id);
    if (ok) await this.persist();
    return ok;
  }

  async appendLog(subaccountId: string | undefined, input: AppendSubaccountLogInput): Promise<SubaccountAuthLog> {
    this.ensureLoaded();
    const log: SubaccountAuthLog = {
      id: randomUUID(),
      subaccountId,
      phase: input.phase,
      status: input.status,
      message: input.message,
      data: input.data,
      createdAt: Date.now()
    };
    this.logs.push(log);
    await appendFile(this.logFile, `${JSON.stringify(log)}\n`, 'utf8');
    return log;
  }

  listLogs(subaccountId?: string): SubaccountAuthLog[] {
    this.ensureLoaded();
    return this.logs
      .filter((log) => !subaccountId || log.subaccountId === subaccountId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  private findByEmail(email: string): Subaccount | undefined {
    const target = email.toLowerCase();
    return [...this.subaccounts.values()].find((account) => account.email.toLowerCase() === target);
  }

  private toView(account: Subaccount): SubaccountView {
    const credentials = account.codexCredentials ?? [];
    return {
      id: account.id,
      email: account.email,
      label: account.label,
      chatgptAccountId: account.chatgptAccountId,
      status: account.status,
      hasWebSession: Boolean(account.webAccessToken),
      codexCredentials: credentials.map((item) => ({
        accountId: codexCredentialAccountId(item),
        fileName: item.fileName,
        groupName: item.groupName,
        hasCredential: true,
        planType: item.planType,
        lastQuota: item.lastQuota,
        lastQuotaAt: item.lastQuotaAt,
        lastAuthAt: item.lastAuthAt
      })),
      teamLinks: account.teamLinks ?? [],
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
      lastError: account.lastError
    };
  }

  private getLatestCodexCredential(account: Subaccount | undefined): SubaccountCodexCredential | undefined {
    return [...(account?.codexCredentials ?? [])].sort(
      (a, b) => (b.lastAuthAt ?? 0) - (a.lastAuthAt ?? 0)
    )[0];
  }

  private findCodexCredential(
    account: Subaccount | undefined,
    accountId: string
  ): SubaccountCodexCredential | undefined {
    const target = accountId.trim();
    return (account?.codexCredentials ?? []).find((item) => codexCredentialAccountId(item) === target);
  }

  private credentialPath(subaccountId: string, fileName: string): string {
    return join(this.dataDir, CREDENTIAL_DIR, subaccountId, fileName);
  }

  private async writeCodexCredential(subaccountId: string, fileName: string, credential: CodexCredentialJson): Promise<void> {
    const dir = join(this.dataDir, CREDENTIAL_DIR, subaccountId);
    await mkdir(dir, { recursive: true });
    await writeFile(this.credentialPath(subaccountId, fileName), JSON.stringify(credential, null, 2), 'utf8');
  }

  private readCodexCredential(account: Subaccount, metadata: SubaccountCodexCredential): CodexCredentialJson | undefined {
    try {
      return JSON.parse(readFileSync(this.credentialPath(account.id, metadata.fileName), 'utf8')) as CodexCredentialJson;
    } catch {
      return undefined;
    }
  }

  private async persist(): Promise<void> {
    await writeFile(this.file, JSON.stringify([...this.subaccounts.values()].map(sanitizeSubaccount), null, 2), 'utf8');
  }
}

async function normalizeStoredSubaccount(
  raw: unknown,
  dataDir: string
): Promise<{ account: Subaccount; changed: boolean } | undefined> {
  if (!raw || typeof raw !== 'object') return undefined;
  const record = raw as LegacySubaccount;
  if (!record.id) return undefined;
  let changed =
    hasOwn(record, 'codexCredential') ||
    hasOwn(record, 'lastQuota') ||
    hasOwn(record, 'lastQuotaAt') ||
    hasOwn(record, 'lastAuthAt');
  const credentials: SubaccountCodexCredential[] = [];
  for (const item of record.codexCredentials ?? []) {
    const legacyCredential = item.credential;
    const accountId =
      legacyCredential?.account_id?.trim() || (typeof item.accountId === 'string' ? item.accountId.trim() : '');
    if (!accountId) {
      changed = true;
      continue;
    }
    const fileName = normalizeCredentialFileName(item.fileName, legacyCredential?.email ?? record.email, accountId);
    if (legacyCredential) {
      await writeCredentialFile(dataDir, record.id, fileName, legacyCredential);
      changed = true;
    }
    changed =
      changed ||
      hasOwn(item, 'credential') ||
      item.accountId !== accountId ||
      item.fileName !== fileName ||
      item.groupName !== normalizeGroupName(item.groupName);
    credentials.push({
      accountId,
      fileName,
      groupName: normalizeGroupName(item.groupName),
      planType: legacyCredential?.plan_type ?? item.planType,
      lastQuota: item.lastQuota,
      lastQuotaAt: item.lastQuotaAt,
      lastAuthAt: item.lastAuthAt
    });
  }
  if (record.codexCredential?.account_id) {
    changed = true;
    const accountId = record.codexCredential.account_id.trim();
    const fileName = normalizeCredentialFileName(undefined, record.codexCredential.email || record.email, accountId);
    await writeCredentialFile(dataDir, record.id, fileName, record.codexCredential);
    credentials.push({
      accountId,
      fileName,
      groupName: DEFAULT_CREDENTIAL_GROUP,
      planType: record.codexCredential.plan_type,
      lastQuota: record.lastQuota,
      lastQuotaAt: record.lastQuotaAt,
      lastAuthAt: record.lastAuthAt
    });
  }
  const teamLinks = (record.teamLinks ?? []).map((link) => {
    changed = changed || hasOwn(link, 'accountLabel') || hasOwn(link, 'chatgptAccountId');
    return {
      accountId: link.accountId,
      seat: link.seat,
      status: link.status,
      updatedAt: link.updatedAt
    };
  });
  const account = sanitizeSubaccount({
    id: record.id,
    email: record.email,
    label: record.label,
    chatgptAccountId: record.chatgptAccountId,
    webAccessToken: record.webAccessToken,
    registrationPassword: record.registrationPassword,
    registeredAt: record.registeredAt,
    registrationSource: record.registrationSource,
    codexCredentials: dedupeCodexCredentials(credentials),
    teamLinks,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastError: record.lastError
  });
  return { account, changed };
}

function sanitizeSubaccount(input: Subaccount): Subaccount {
  return {
    id: input.id,
    email: input.email,
    label: input.label,
    chatgptAccountId: input.chatgptAccountId,
    webAccessToken: input.webAccessToken,
    registrationPassword: input.registrationPassword,
    registeredAt: input.registeredAt,
    registrationSource: input.registrationSource,
    codexCredentials: dedupeCodexCredentials(input.codexCredentials ?? []),
    teamLinks: (input.teamLinks ?? []).map((link) => ({
      accountId: link.accountId,
      seat: link.seat,
      status: link.status,
      updatedAt: link.updatedAt
    })),
    status: input.status,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    lastError: input.lastError
  };
}

function upsertCodexCredential(
  current: SubaccountCodexCredential[],
  next: SubaccountCodexCredential
): SubaccountCodexCredential[] {
  const accountId = codexCredentialAccountId(next);
  return dedupeCodexCredentials([
    next,
    ...current.filter((item) => codexCredentialAccountId(item) !== accountId)
  ]);
}

function dedupeCodexCredentials(items: SubaccountCodexCredential[]): SubaccountCodexCredential[] {
  const byAccountId = new Map<string, SubaccountCodexCredential>();
  for (const item of items) {
    const accountId = codexCredentialAccountId(item);
    if (!accountId) continue;
    const existing = byAccountId.get(accountId);
    if (!existing || (item.lastAuthAt ?? 0) >= (existing.lastAuthAt ?? 0)) {
      byAccountId.set(accountId, {
        accountId,
        fileName: item.fileName,
        groupName: item.groupName || DEFAULT_CREDENTIAL_GROUP,
        planType: item.planType,
        lastQuota: item.lastQuota,
        lastQuotaAt: item.lastQuotaAt,
        lastAuthAt: item.lastAuthAt
      });
    }
  }
  return [...byAccountId.values()];
}

async function writeCredentialFile(
  dataDir: string,
  subaccountId: string,
  fileName: string,
  credential: CodexCredentialJson
): Promise<void> {
  const dir = join(dataDir, CREDENTIAL_DIR, subaccountId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, fileName), JSON.stringify(credential, null, 2), 'utf8');
}
