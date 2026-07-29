import { existsSync, readFileSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  parseChatGptSessionInput,
  subaccountSummaryFromView,
  type ChatGptSessionInput,
  type CodexCredentialJson,
  type CodexQuotaSnapshot,
  type Subaccount,
  type SubaccountAuthLog,
  type SubaccountCodexCredential,
  type SubaccountLocalProfileView,
  type SubaccountSummaryView,
  type SubaccountTeamLink,
  type SubaccountView
} from '@team-manager/shared';
import {
  appendPrivateFile,
  ensurePrivateDirectory,
  ensurePrivateFile,
  writePrivateFile
} from './privateDataFile.js';

export interface AppendSubaccountLogInput {
  phase: string;
  status: string;
  message: string;
  data?: Record<string, unknown>;
}

function codexCredentialAccountId(item: SubaccountCodexCredential): string {
  return item.accountId.trim();
}

const DEFAULT_CREDENTIAL_GROUP = '默认号池';
const DEFAULT_SUBACCOUNT_GROUP = '默认分组';
const CREDENTIAL_DIR = 'subaccount-credentials';
const SUBACCOUNT_LOG_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_SUBACCOUNT_LOGS = 2_000;

function retainSubaccountLogs(logs: SubaccountAuthLog[], now = Date.now()): SubaccountAuthLog[] {
  const cutoff = now - SUBACCOUNT_LOG_RETENTION_MS;
  return logs
    .filter((log) => Number.isFinite(log.createdAt) && log.createdAt >= cutoff)
    .slice(-MAX_SUBACCOUNT_LOGS);
}

function serializeSubaccountLogs(logs: SubaccountAuthLog[]): string {
  return logs.length ? `${logs.map((log) => JSON.stringify(log)).join('\n')}\n` : '';
}

function normalizeGroupName(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_CREDENTIAL_GROUP;
}

function normalizeSubaccountGroupName(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_SUBACCOUNT_GROUP;
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
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

/** 子号持久化：保存 Team 业务需要的 Web Session；账号密码与 CloakBrowser profile 由 Account Manager 持有。 */
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
    await ensurePrivateDirectory(this.dataDir);
    if (existsSync(this.file)) await ensurePrivateFile(this.file);
    if (existsSync(this.logFile)) await ensurePrivateFile(this.logFile);
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
      const lines = raw
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      const parsed = lines
        .map((line) => JSON.parse(line) as SubaccountAuthLog)
        .filter((log) => Boolean(log.id));
      this.logs = retainSubaccountLogs(parsed);
      if (this.logs.length !== lines.length) {
        await writePrivateFile(this.logFile, serializeSubaccountLogs(this.logs));
      }
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

  listSummaries(): SubaccountSummaryView[] {
    this.ensureLoaded();
    return [...this.subaccounts.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((account) => subaccountSummaryFromView(this.toView(account)));
  }

  detail(id: string): SubaccountView | undefined {
    this.ensureLoaded();
    const account = this.subaccounts.get(id);
    if (!account) return undefined;
    const detail = this.toView(account);
    delete detail.proxy;
    delete detail.session;
    return detail;
  }

  localProfile(id: string): SubaccountLocalProfileView | undefined {
    this.ensureLoaded();
    const account = this.subaccounts.get(id);
    if (!account) return undefined;
    const view = this.toView(account);
    return {
      id: view.id,
      remark: view.remark,
      groupName: view.groupName,
      isBanned: view.isBanned,
      proxy: view.proxy,
      session: view.session
    };
  }

  get(id: string): Subaccount | undefined {
    this.ensureLoaded();
    return this.subaccounts.get(id);
  }

  getByEmail(email: string): Subaccount | undefined {
    this.ensureLoaded();
    return this.findByEmail(email);
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

  async importSession(
    raw: unknown,
    options: { remark?: unknown; groupName?: unknown; isBanned?: unknown; proxy?: unknown } = {}
  ): Promise<SubaccountView> {
    this.ensureLoaded();
    const session = parseChatGptSessionInput(raw);
    if ('error' in session) throw new Error(session.error);
    const hasRemark = Object.prototype.hasOwnProperty.call(options, 'remark');
    const hasGroupName = Object.prototype.hasOwnProperty.call(options, 'groupName');
    const hasIsBanned = Object.prototype.hasOwnProperty.call(options, 'isBanned');
    const hasProxy = Object.prototype.hasOwnProperty.call(options, 'proxy');

    const now = Date.now();
    const existing = this.findByEmail(session.user.email);
    const next: Subaccount = {
      ...existing,
      id: existing?.id ?? randomUUID(),
      email: session.user.email,
      remark: hasRemark ? normalizeOptionalString(options.remark) : existing?.remark,
      groupName: hasGroupName ? normalizeSubaccountGroupName(options.groupName) : existing?.groupName,
      isBanned: hasIsBanned ? options.isBanned === true : existing?.isBanned,
      chatgptAccountId: session.account.id,
      webAccessToken: session.accessToken,
      sessionToken: session.sessionToken,
      sessionTokenStatus: 'unknown',
      sessionTokenCheckedAt: undefined,
      webAccessTokenStatus: 'unknown',
      webAccessTokenCheckedAt: undefined,
      proxy: hasProxy ? normalizeOptionalString(options.proxy) : existing?.proxy,
      codexCredentials: existing?.codexCredentials,
      teamLinks: existing?.teamLinks,
      status: existing?.codexCredentials?.length ? 'codex_ready' : 'session_ready',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastRefreshAt: undefined,
      lastError: undefined
    };

    this.subaccounts.set(next.id, next);
    await this.persist();
    return this.toView(next);
  }

  async saveManagedSubaccount(input: {
    managedAccountEmail: string;
    email: string;
    session: ChatGptSessionInput;
    status?: Subaccount['status'];
    lastError?: string;
  }): Promise<SubaccountView> {
    this.ensureLoaded();
    const email = input.email.trim();
    if (!email) throw new Error('注册结果缺少 email');
    const managedAccountEmail = input.managedAccountEmail.trim().toLowerCase();
    if (managedAccountEmail !== email.toLowerCase()) {
      throw new Error(`Account Manager 引用与子号邮箱不一致: ${managedAccountEmail} != ${email}`);
    }
    if (input.session.user.email.trim().toLowerCase() !== email.toLowerCase()) {
      throw new Error(`注册结果邮箱与 session.user.email 不一致: ${email} != ${input.session.user.email}`);
    }

    const now = Date.now();
    const existing = this.findByEmail(email);
    const next: Subaccount = {
      ...existing,
      id: existing?.id ?? randomUUID(),
      email,
      remark: existing?.remark,
      groupName: existing?.groupName,
      chatgptAccountId: input.session.account.id,
      webAccessToken: input.session.accessToken,
      sessionToken: input.session.sessionToken,
      sessionTokenStatus: 'unknown',
      sessionTokenCheckedAt: undefined,
      webAccessTokenStatus: 'unknown',
      webAccessTokenCheckedAt: undefined,
      proxy: existing?.proxy,
      managedAccountEmail,
      codexCredentials: existing?.codexCredentials,
      teamLinks: existing?.teamLinks,
      status: input.status ?? (existing?.codexCredentials?.length ? 'codex_ready' : 'session_ready'),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastRefreshAt: undefined,
      lastError: input.lastError
    };

    this.subaccounts.set(next.id, next);
    await this.persist();
    return this.toView(next);
  }

  async updateLocalProfile(
    id: string,
    input: { remark?: string; groupName?: string; isBanned?: boolean; proxy?: string; session?: ChatGptSessionInput }
  ): Promise<SubaccountView | undefined> {
    this.ensureLoaded();
    const existing = this.subaccounts.get(id);
    if (!existing) return undefined;
    const credentials = existing.codexCredentials ?? [];
    const merged: Subaccount = {
      ...existing,
      remark: Object.prototype.hasOwnProperty.call(input, 'remark') ? input.remark : existing.remark,
      groupName: Object.prototype.hasOwnProperty.call(input, 'groupName')
        ? normalizeSubaccountGroupName(input.groupName)
        : existing.groupName,
      isBanned: Object.prototype.hasOwnProperty.call(input, 'isBanned') ? input.isBanned : existing.isBanned,
      email: input.session?.user.email ?? existing.email,
      chatgptAccountId: input.session?.account.id ?? existing.chatgptAccountId,
      webAccessToken: input.session?.accessToken ?? existing.webAccessToken,
      sessionToken: input.session === undefined ? existing.sessionToken : input.session.sessionToken,
      sessionTokenStatus: input.session === undefined ? existing.sessionTokenStatus : 'unknown',
      sessionTokenCheckedAt: input.session === undefined ? existing.sessionTokenCheckedAt : undefined,
      webAccessTokenStatus: input.session === undefined ? existing.webAccessTokenStatus : 'unknown',
      webAccessTokenCheckedAt: input.session === undefined ? existing.webAccessTokenCheckedAt : undefined,
      proxy: Object.prototype.hasOwnProperty.call(input, 'proxy') ? input.proxy : existing.proxy,
      status: credentials.length ? 'codex_ready' : 'session_ready',
      updatedAt: Date.now(),
      lastRefreshAt: input.session === undefined ? existing.lastRefreshAt : undefined,
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
    const parsedCredential = parseCodexCredential(credential);
    if (!parsedCredential) throw new Error('Codex 凭证格式不支持');
    const existing = this.subaccounts.get(id);
    if (!existing) return undefined;
    const now = Date.now();
    const accountId = parsedCredential.account_id.trim();
    if (!accountId) throw new Error('Codex 凭证缺少 account_id');
    const existingMeta = this.findCodexCredential(existing, accountId);
    const fileName = existingMeta?.fileName ?? normalizeCredentialFileName(undefined, parsedCredential.email || existing.email, accountId);
    await this.writeCodexCredential(id, fileName, parsedCredential);
    const credentials = upsertCodexCredential(existing.codexCredentials ?? [], {
      accountId,
      fileName,
      groupName: existingMeta?.groupName ?? DEFAULT_CREDENTIAL_GROUP,
      planType: parsedCredential.plan_type,
      lastCreatedAt: now
    });
    const merged: Subaccount = {
      ...existing,
      email: parsedCredential.email || existing.email,
      remark: existing.remark,
      codexCredentials: credentials,
      status: 'codex_ready',
      updatedAt: now,
      lastError: undefined
    };
    this.subaccounts.set(id, merged);
    await this.persist();
    return this.toView(merged);
  }

  async removeCodexCredential(id: string, accountId: string): Promise<SubaccountView | undefined> {
    this.ensureLoaded();
    const existing = this.subaccounts.get(id);
    if (!existing) return undefined;
    const target = accountId.trim();
    const credential = this.findCodexCredential(existing, target);
    if (!credential) return undefined;

    await unlink(this.credentialPath(id, credential.fileName)).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== 'ENOENT') throw e;
    });

    const credentials = (existing.codexCredentials ?? []).filter(
      (item) => codexCredentialAccountId(item) !== target
    );
    const now = Date.now();
    const merged: Subaccount = {
      ...existing,
      codexCredentials: credentials,
      status: statusAfterCredentialRemoval(existing, credentials),
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
    const accountId = link.accountId.trim();
    const workspaceId = link.workspaceId?.trim() || undefined;
    const links = [
      ...(existing.teamLinks ?? []).filter((item) => {
        const itemWorkspaceId = item.workspaceId?.trim();
        if (item.accountId === accountId) return false;
        if (workspaceId && (itemWorkspaceId === workspaceId || item.accountId === workspaceId)) return false;
        if (itemWorkspaceId && itemWorkspaceId === accountId) return false;
        return true;
      }),
      {
        ...link,
        accountId,
        workspaceId,
        workspaceName: link.workspaceName?.trim() || undefined,
        planType: link.planType?.trim() || undefined,
        role: link.role?.trim() || undefined,
        updatedAt: now
      }
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

  async replaceTeamLinks(
    id: string,
    links: Array<Omit<SubaccountTeamLink, 'updatedAt'>>
  ): Promise<SubaccountView | undefined> {
    this.ensureLoaded();
    const existing = this.subaccounts.get(id);
    if (!existing) return undefined;
    const now = Date.now();
    const normalized = new Map<string, SubaccountTeamLink>();
    for (const link of links) {
      const accountId = link.accountId.trim();
      const workspaceId = link.workspaceId?.trim() || undefined;
      if (!accountId) continue;
      normalized.set(workspaceId || accountId, {
        ...link,
        accountId,
        workspaceId,
        workspaceName: link.workspaceName?.trim() || undefined,
        planType: link.planType?.trim() || undefined,
        role: link.role?.trim() || undefined,
        updatedAt: now
      });
    }
    const merged: Subaccount = {
      ...existing,
      teamLinks: [...normalized.values()],
      updatedAt: now,
      lastRefreshAt: now,
      lastError: undefined
    };
    this.subaccounts.set(id, merged);
    await this.persist();
    return this.toView(merged);
  }

  async removeTeamLink(id: string, targetAccountId: string): Promise<SubaccountView | undefined> {
    this.ensureLoaded();
    const existing = this.subaccounts.get(id);
    if (!existing) return undefined;
    const target = targetAccountId.trim();
    if (!target) return this.toView(existing);
    const links = (existing.teamLinks ?? []).filter(
      (item) => item.accountId !== target && item.workspaceId !== target
    );
    const now = Date.now();
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
    const nextLogs = retainSubaccountLogs([...this.logs, log], log.createdAt);
    const requiresRewrite = nextLogs.length !== this.logs.length + 1;
    this.logs = nextLogs;
    if (requiresRewrite) {
      await writePrivateFile(this.logFile, serializeSubaccountLogs(this.logs));
    } else {
      await appendPrivateFile(this.logFile, `${JSON.stringify(log)}\n`);
    }
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
      remark: account.remark,
      groupName: normalizeSubaccountGroupName(account.groupName),
      isBanned: account.isBanned === true,
      chatgptAccountId: account.chatgptAccountId,
      proxy: account.proxy,
      managedAccountEmail: account.managedAccountEmail,
      chatgptUserId: account.chatgptUserId,
      remoteUsername: account.remoteUsername,
      remoteDisplayName: account.remoteDisplayName,
      remotePictureUrl: account.remotePictureUrl,
      personalProfileCachedAt: account.personalProfileCachedAt,
      sessionTokenStatus: account.sessionTokenStatus ?? 'unknown',
      sessionTokenCheckedAt: account.sessionTokenCheckedAt,
      webAccessTokenStatus: account.webAccessTokenStatus ?? 'unknown',
      webAccessTokenCheckedAt: account.webAccessTokenCheckedAt,
      marketingPushEnabled: account.marketingPushEnabled,
      marketingEmailEnabled: account.marketingEmailEnabled,
      marketingNotificationsCachedAt: account.marketingNotificationsCachedAt,
      memoryEnabled: account.memoryEnabled,
      memoryCachedAt: account.memoryCachedAt,
      rateLimitResetCredits: account.rateLimitResetCredits,
      session:
        account.webAccessToken && account.chatgptAccountId
          ? {
              user: { email: account.email },
              account: { id: account.chatgptAccountId },
              accessToken: account.webAccessToken,
              ...(account.sessionToken ? { sessionToken: account.sessionToken } : {})
            }
          : undefined,
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
        lastCreatedAt: item.lastCreatedAt
      })),
      teamLinks: account.teamLinks ?? [],
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
      lastRefreshAt: account.lastRefreshAt,
      lastError: account.lastError
    };
  }

  private getLatestCodexCredential(account: Subaccount | undefined): SubaccountCodexCredential | undefined {
    return [...(account?.codexCredentials ?? [])].sort(
      (a, b) => (b.lastCreatedAt ?? 0) - (a.lastCreatedAt ?? 0)
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
    const parsedCredential = parseCodexCredential(credential);
    if (!parsedCredential) throw new Error('Codex 凭证格式不支持');
    const dir = join(this.dataDir, CREDENTIAL_DIR, subaccountId);
    await ensurePrivateDirectory(dir);
    await writePrivateFile(this.credentialPath(subaccountId, fileName), JSON.stringify(parsedCredential, null, 2));
  }

  private readCodexCredential(account: Subaccount, metadata: SubaccountCodexCredential): CodexCredentialJson | undefined {
    try {
      return parseCodexCredential(
        JSON.parse(readFileSync(this.credentialPath(account.id, metadata.fileName), 'utf8'))
      );
    } catch {
      return undefined;
    }
  }

  private async persist(): Promise<void> {
    await writePrivateFile(this.file, JSON.stringify([...this.subaccounts.values()].map(sanitizeSubaccount), null, 2));
  }
}

async function normalizeStoredSubaccount(
  raw: unknown,
  dataDir: string
): Promise<{ account: Subaccount; changed: boolean } | undefined> {
  if (!raw || typeof raw !== 'object') return undefined;
  const record = raw as Subaccount;
  if (!record.id) return undefined;
  let changed = record.groupName !== normalizeSubaccountGroupName(record.groupName);
  const credentials: SubaccountCodexCredential[] = [];
  for (const item of record.codexCredentials ?? []) {
    const accountId = typeof item.accountId === 'string' ? item.accountId.trim() : '';
    if (!accountId) {
      changed = true;
      continue;
    }
    const fileName = normalizeCredentialFileName(item.fileName, record.email, accountId);
    const credential = await readCodexCredentialFile(dataDir, record.id, fileName);
    if (!credential) {
      changed = true;
      await unlink(join(dataDir, CREDENTIAL_DIR, record.id, fileName)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
      continue;
    }
    changed =
      changed ||
      item.accountId !== accountId ||
      item.fileName !== fileName ||
      item.groupName !== normalizeGroupName(item.groupName);
    credentials.push({
      accountId,
      fileName,
      groupName: normalizeGroupName(item.groupName),
      planType: credential.plan_type ?? item.planType,
      lastQuota: item.lastQuota,
      lastQuotaAt: item.lastQuotaAt,
      lastCreatedAt: item.lastCreatedAt
    });
  }
  const teamLinks = (record.teamLinks ?? []).map((link) => {
    return {
      accountId: link.accountId,
      workspaceId: typeof link.workspaceId === 'string' && link.workspaceId.trim() ? link.workspaceId.trim() : undefined,
      workspaceName: typeof link.workspaceName === 'string' && link.workspaceName.trim() ? link.workspaceName.trim() : undefined,
      planType: typeof link.planType === 'string' && link.planType.trim() ? link.planType.trim() : undefined,
      role: typeof link.role === 'string' && link.role.trim() ? link.role.trim() : undefined,
      seat: link.seat,
      status: link.status,
      updatedAt: link.updatedAt
    };
  });
  const account = sanitizeSubaccount({
    id: record.id,
    email: record.email,
    remark: record.remark,
    groupName: record.groupName,
    isBanned: record.isBanned === true,
    chatgptAccountId: record.chatgptAccountId,
    webAccessToken: record.webAccessToken,
    sessionToken: record.sessionToken,
    webSessionCookies: normalizeWebSessionCookies(record.webSessionCookies),
    proxy: record.proxy,
    managedAccountEmail: record.managedAccountEmail,
    chatgptUserId: record.chatgptUserId,
    remoteUsername: record.remoteUsername,
    remoteDisplayName: record.remoteDisplayName,
    remotePictureUrl: record.remotePictureUrl,
    personalProfileCachedAt: record.personalProfileCachedAt,
    sessionTokenStatus: record.sessionTokenStatus,
    sessionTokenCheckedAt: record.sessionTokenCheckedAt,
    webAccessTokenStatus: record.webAccessTokenStatus,
    webAccessTokenCheckedAt: record.webAccessTokenCheckedAt,
    marketingPushEnabled: record.marketingPushEnabled,
    marketingEmailEnabled: record.marketingEmailEnabled,
    marketingNotificationsCachedAt: record.marketingNotificationsCachedAt,
    memoryEnabled: record.memoryEnabled,
    memoryCachedAt: record.memoryCachedAt,
    rateLimitResetCredits: normalizeRateLimitCredits(record.rateLimitResetCredits),
    codexCredentials: dedupeCodexCredentials(credentials),
    teamLinks,
    status: normalizeStoredSubaccountStatus(record.status, credentials.length > 0, Boolean(record.webAccessToken || record.sessionToken)),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastRefreshAt: record.lastRefreshAt,
    lastError: record.lastError
  });
  changed = changed || account.status !== (record.status as unknown);
  return { account, changed };
}

function sanitizeSubaccount(input: Subaccount): Subaccount {
  return {
    id: input.id,
    email: input.email,
    remark: input.remark?.trim() || undefined,
    groupName: normalizeSubaccountGroupName(input.groupName),
    isBanned: input.isBanned === true,
    chatgptAccountId: input.chatgptAccountId,
    webAccessToken: input.webAccessToken,
    sessionToken: input.sessionToken,
    webSessionCookies: normalizeWebSessionCookies(input.webSessionCookies),
    proxy: input.proxy?.trim() || undefined,
    managedAccountEmail: input.managedAccountEmail?.trim().toLowerCase() || undefined,
    chatgptUserId: input.chatgptUserId?.trim() || undefined,
    remoteUsername: input.remoteUsername?.trim() || undefined,
    remoteDisplayName: input.remoteDisplayName?.trim() || undefined,
    remotePictureUrl: input.remotePictureUrl?.trim() || undefined,
    personalProfileCachedAt: input.personalProfileCachedAt,
    sessionTokenStatus: normalizeCheckStatus(input.sessionTokenStatus),
    sessionTokenCheckedAt: input.sessionTokenCheckedAt,
    webAccessTokenStatus: normalizeCheckStatus(input.webAccessTokenStatus),
    webAccessTokenCheckedAt: input.webAccessTokenCheckedAt,
    marketingPushEnabled: input.marketingPushEnabled,
    marketingEmailEnabled: input.marketingEmailEnabled,
    marketingNotificationsCachedAt: input.marketingNotificationsCachedAt,
    memoryEnabled: input.memoryEnabled,
    memoryCachedAt: input.memoryCachedAt,
    rateLimitResetCredits: normalizeRateLimitCredits(input.rateLimitResetCredits),
    codexCredentials: dedupeCodexCredentials(input.codexCredentials ?? []),
    teamLinks: (input.teamLinks ?? []).map((link) => ({
      accountId: link.accountId,
      workspaceId: link.workspaceId?.trim() || undefined,
      workspaceName: link.workspaceName?.trim() || undefined,
      planType: link.planType?.trim() || undefined,
      role: link.role?.trim() || undefined,
      seat: link.seat,
      status: link.status,
      updatedAt: link.updatedAt
    })),
    status: input.status,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    lastRefreshAt: input.lastRefreshAt,
    lastError: input.lastError
  };
}

function normalizeWebSessionCookies(value: unknown): Subaccount['webSessionCookies'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const cookies = {
    oaiDid: normalizeOptionalString(record.oaiDid),
    clientAuthInfo: normalizeOptionalString(record.clientAuthInfo),
    puid: normalizeOptionalString(record.puid),
    oaiIs: normalizeOptionalString(record.oaiIs)
  };
  return Object.values(cookies).some(Boolean) ? cookies : undefined;
}

function normalizeCheckStatus(value: unknown): Subaccount['sessionTokenStatus'] {
  return value === 'valid' || value === 'invalid' || value === 'unknown' ? value : undefined;
}

function normalizeStoredSubaccountStatus(
  value: unknown,
  hasCredential: boolean,
  hasSession: boolean
): Subaccount['status'] {
  if (value === 'account_locked' || value === 'verification_required' || value === 'error') return value;
  if (value === 'pat_creating' || value === 'codex_auth_pending') {
    return hasCredential ? 'codex_ready' : hasSession ? 'session_ready' : 'empty';
  }
  if (value === 'codex_ready' && hasCredential) return value;
  if (value === 'session_ready' && hasSession) return value;
  return hasCredential ? 'codex_ready' : hasSession ? 'session_ready' : 'empty';
}

function normalizeRateLimitCredits(value: unknown): Subaccount['rateLimitResetCredits'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.credits)) return undefined;
  if (typeof record.availableCount !== 'number' || typeof record.totalEarnedCount !== 'number') return undefined;
  return {
    credits: record.credits,
    availableCount: record.availableCount,
    totalEarnedCount: record.totalEarnedCount,
    cachedAt: typeof record.cachedAt === 'number' ? record.cachedAt : Date.now()
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
    if (!existing || (item.lastCreatedAt ?? 0) >= (existing.lastCreatedAt ?? 0)) {
      byAccountId.set(accountId, {
        accountId,
        fileName: item.fileName,
        groupName: item.groupName || DEFAULT_CREDENTIAL_GROUP,
        planType: item.planType,
        lastQuota: item.lastQuota,
        lastQuotaAt: item.lastQuotaAt,
        lastCreatedAt: item.lastCreatedAt
      });
    }
  }
  return [...byAccountId.values()];
}

function statusAfterCredentialRemoval(account: Subaccount, credentials: SubaccountCodexCredential[]): Subaccount['status'] {
  if (credentials.length) return 'codex_ready';
  if (account.status === 'account_locked' || account.status === 'verification_required') return account.status;
  if (account.webAccessToken || account.sessionToken) return 'session_ready';
  return 'empty';
}

async function writeCredentialFile(
  dataDir: string,
  subaccountId: string,
  fileName: string,
  credential: CodexCredentialJson
): Promise<void> {
  const parsedCredential = parseCodexCredential(credential);
  if (!parsedCredential) throw new Error('Codex 凭证格式不支持');
  const dir = join(dataDir, CREDENTIAL_DIR, subaccountId);
  await ensurePrivateDirectory(dir);
  await writePrivateFile(join(dir, fileName), JSON.stringify(parsedCredential, null, 2));
}

async function readCodexCredentialFile(
  dataDir: string,
  subaccountId: string,
  fileName: string
): Promise<CodexCredentialJson | undefined> {
  const dir = join(dataDir, CREDENTIAL_DIR, subaccountId);
  const path = join(dir, fileName);
  if (!existsSync(path)) return undefined;
  try {
    await ensurePrivateDirectory(dir);
    await ensurePrivateFile(path);
    return parseCodexCredential(
      JSON.parse(await readFile(path, 'utf8'))
    );
  } catch {
    return undefined;
  }
}

function parseCodexCredential(value: unknown): CodexCredentialJson | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record.type !== 'codex') return undefined;
  const accessToken = normalizeOptionalString(record.access_token);
  const accountId = normalizeOptionalString(record.account_id);
  const lastRefresh = normalizeOptionalString(record.last_refresh);
  const email = normalizeOptionalString(record.email);
  const expired = normalizeOptionalString(record.expired);
  if (!accessToken || !accountId || !lastRefresh || !email || !expired) return undefined;
  const common = {
    access_token: accessToken,
    account_id: accountId,
    last_refresh: lastRefresh,
    email,
    type: 'codex',
    expired,
    plan_type: normalizeOptionalString(record.plan_type)
  } as const;

  const personalAccessToken = normalizeOptionalString(record.personal_access_token);
  if (record.auth_mode === 'personalAccessToken' || record.credential_source === 'personal_access_token') {
    if (!personalAccessToken || accessToken !== personalAccessToken) return undefined;
    return {
      ...common,
      personal_access_token: personalAccessToken,
      auth_mode: 'personalAccessToken',
      credential_source: 'personal_access_token',
      credential_id: normalizeOptionalString(record.credential_id),
      chatgpt_user_id: normalizeOptionalString(record.chatgpt_user_id)
    };
  }

  const idToken = normalizeOptionalString(record.id_token);
  const refreshToken = normalizeOptionalString(record.refresh_token);
  const oauthMarkersValid = (record.auth_mode === undefined || record.auth_mode === 'chatgpt')
    && (record.credential_source === undefined || record.credential_source === 'oauth');
  if (!oauthMarkersValid || !idToken || !refreshToken) return undefined;
  return {
    ...common,
    id_token: idToken,
    refresh_token: refreshToken,
    auth_mode: 'chatgpt',
    credential_source: 'oauth'
  };
}
