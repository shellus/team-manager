import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
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
      for (const rawAccount of arr) {
        const account = normalizeStoredSubaccount(rawAccount);
        if (account?.id) this.subaccounts.set(account.id, account);
      }
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
    return this.getLatestCodexCredential(this.subaccounts.get(id))?.credential;
  }

  getCodexCredentialForAccount(id: string, accountId: string): CodexCredentialJson | undefined {
    this.ensureLoaded();
    return this.findCodexCredential(this.subaccounts.get(id), accountId)?.credential;
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
    const credentials = upsertCodexCredential(existing.codexCredentials ?? [], {
      accountId,
      credential,
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
    const credentials = (existing.codexCredentials ?? []).map((item) =>
      item.accountId === accountId ? { ...item, lastQuota: snapshot, lastQuotaAt: now } : item
    );
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
    const latestCredential = this.getLatestCodexCredential(account);
    return {
      id: account.id,
      email: account.email,
      label: account.label,
      chatgptAccountId: account.chatgptAccountId,
      status: account.status,
      hasWebSession: Boolean(account.webAccessToken),
      hasCodexCredential: credentials.length > 0,
      codexCredentials: credentials.map((item) => ({
        accountId: item.accountId,
        hasCredential: true,
        planType: item.credential.plan_type,
        lastQuota: item.lastQuota,
        lastQuotaAt: item.lastQuotaAt,
        lastAuthAt: item.lastAuthAt
      })),
      teamLinks: account.teamLinks ?? [],
      lastQuota: latestCredential?.lastQuota,
      lastQuotaAt: latestCredential?.lastQuotaAt,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
      lastAuthAt: latestCredential?.lastAuthAt,
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
    return (account?.codexCredentials ?? []).find((item) => item.accountId === target);
  }

  private async persist(): Promise<void> {
    await writeFile(this.file, JSON.stringify([...this.subaccounts.values()], null, 2), 'utf8');
  }
}

function normalizeStoredSubaccount(raw: unknown): Subaccount | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const record = raw as Subaccount & {
    codexCredential?: CodexCredentialJson;
    lastQuota?: CodexQuotaSnapshot;
    lastQuotaAt?: number;
    lastAuthAt?: number;
  };
  if (!record.id) return undefined;
  const credentials = [...(record.codexCredentials ?? [])];
  if (record.codexCredential?.account_id) {
    credentials.push({
      accountId: record.codexCredential.account_id,
      credential: record.codexCredential,
      lastQuota: record.lastQuota,
      lastQuotaAt: record.lastQuotaAt,
      lastAuthAt: record.lastAuthAt
    });
  }
  return {
    id: record.id,
    email: record.email,
    label: record.label,
    chatgptAccountId: record.chatgptAccountId,
    webAccessToken: record.webAccessToken,
    codexCredentials: dedupeCodexCredentials(credentials),
    teamLinks: record.teamLinks,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastError: record.lastError
  };
}

function upsertCodexCredential(
  current: SubaccountCodexCredential[],
  next: SubaccountCodexCredential
): SubaccountCodexCredential[] {
  return dedupeCodexCredentials([
    next,
    ...current.filter((item) => item.accountId !== next.accountId)
  ]);
}

function dedupeCodexCredentials(items: SubaccountCodexCredential[]): SubaccountCodexCredential[] {
  const byAccountId = new Map<string, SubaccountCodexCredential>();
  for (const item of items) {
    if (!item.accountId.trim()) continue;
    const existing = byAccountId.get(item.accountId);
    if (!existing || (item.lastAuthAt ?? 0) >= (existing.lastAuthAt ?? 0)) {
      byAccountId.set(item.accountId, item);
    }
  }
  return [...byAccountId.values()];
}
