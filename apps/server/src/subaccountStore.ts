import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile, appendFile, unlink } from 'node:fs/promises';
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

type LegacySubaccount = Subaccount & {
  codexCredential?: CodexCredentialJson;
  codexCredentials?: LegacySubaccountCodexCredential[];
  teamLinks?: SubaccountTeamLink[];
  lastQuota?: CodexQuotaSnapshot;
  lastQuotaAt?: number;
};

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function codexCredentialAccountId(item: SubaccountCodexCredential): string {
  return item.accountId.trim();
}

const DEFAULT_CREDENTIAL_GROUP = '默认号池';
const DEFAULT_SUBACCOUNT_GROUP = '默认分组';
const CREDENTIAL_DIR = 'subaccount-credentials';

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

/** 子号持久化：可信管理后台可查看 Web session 与注册密码；Codex 凭证明文只由显式导出接口返回。 */
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
    options: { remark?: unknown; groupName?: unknown; proxy?: unknown } = {}
  ): Promise<SubaccountView> {
    this.ensureLoaded();
    const session = parseChatGptSessionInput(raw);
    if ('error' in session) throw new Error(session.error);
    const hasRemark = Object.prototype.hasOwnProperty.call(options, 'remark');
    const hasGroupName = Object.prototype.hasOwnProperty.call(options, 'groupName');
    const hasProxy = Object.prototype.hasOwnProperty.call(options, 'proxy');

    const now = Date.now();
    const existing = this.findByEmail(session.user.email);
    const next: Subaccount = {
      ...existing,
      id: existing?.id ?? randomUUID(),
      email: session.user.email,
      remark: hasRemark ? normalizeOptionalString(options.remark) : existing?.remark,
      groupName: hasGroupName ? normalizeSubaccountGroupName(options.groupName) : existing?.groupName,
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

  async saveRegisteredSubaccount(input: {
    registrationJobId?: string;
    registeredAt?: number;
    email: string;
    password: string;
    session?: ChatGptSessionInput;
    source?: string;
    registrationMethod?: 'cloak_browser';
    cloakProfileId?: string;
    cloakProfileName?: string;
    status?: Subaccount['status'];
    lastError?: string;
  }): Promise<SubaccountView> {
    this.ensureLoaded();
    const email = input.email.trim();
    if (!email) throw new Error('注册结果缺少 email');
    if (!input.password.trim()) throw new Error('注册结果缺少 password');
    if (input.session && input.session.user.email.trim().toLowerCase() !== email.toLowerCase()) {
      throw new Error(`注册结果邮箱与 session.user.email 不一致: ${email} != ${input.session.user.email}`);
    }

    const now = Date.now();
    const existing = this.findByEmail(email);
    const failedRegistrationWithExistingSession = !input.session
      && Boolean(existing?.chatgptAccountId && (existing.webAccessToken || existing.sessionToken))
      && (input.status === 'error' || input.status === 'verification_required');
    const next: Subaccount = {
      ...existing,
      id: existing?.id ?? randomUUID(),
      email,
      remark: existing?.remark,
      groupName: existing?.groupName,
      chatgptAccountId: input.session?.account.id ?? existing?.chatgptAccountId,
      webAccessToken: input.session?.accessToken ?? existing?.webAccessToken,
      sessionToken: input.session?.sessionToken ?? existing?.sessionToken,
      sessionTokenStatus: input.session ? 'unknown' : existing?.sessionTokenStatus,
      sessionTokenCheckedAt: input.session ? undefined : existing?.sessionTokenCheckedAt,
      webAccessTokenStatus: input.session ? 'unknown' : existing?.webAccessTokenStatus,
      webAccessTokenCheckedAt: input.session ? undefined : existing?.webAccessTokenCheckedAt,
      proxy: existing?.proxy,
      registrationPassword: input.password,
      registrationJobId: input.registrationJobId ?? existing?.registrationJobId,
      registeredAt: existing?.registeredAt ?? input.registeredAt ?? now,
      registrationSource: input.source,
      registrationMethod: input.registrationMethod ?? existing?.registrationMethod,
      cloakProfileId: input.cloakProfileId ?? existing?.cloakProfileId,
      cloakProfileName: input.cloakProfileName ?? existing?.cloakProfileName,
      codexCredentials: existing?.codexCredentials,
      teamLinks: existing?.teamLinks,
      status: failedRegistrationWithExistingSession
        ? existing?.codexCredentials?.length ? 'codex_ready' : 'session_ready'
        : input.status ?? (existing?.codexCredentials?.length ? 'codex_ready' : 'session_ready'),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastRefreshAt: input.session ? undefined : existing?.lastRefreshAt,
      lastError: input.lastError
    };

    this.subaccounts.set(next.id, next);
    await this.persist();
    return this.toView(next);
  }

  async updateLocalProfile(
    id: string,
    input: { remark?: string; groupName?: string; proxy?: string; session?: ChatGptSessionInput }
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
    const patCredential = parsePersonalAccessTokenCredential(credential);
    if (!patCredential) throw new Error('只允许保存 PAT 凭证');
    const existing = this.subaccounts.get(id);
    if (!existing) return undefined;
    const now = Date.now();
    const accountId = patCredential.account_id.trim();
    if (!accountId) throw new Error('Codex 凭证缺少 account_id');
    const existingMeta = this.findCodexCredential(existing, accountId);
    const fileName = existingMeta?.fileName ?? normalizeCredentialFileName(undefined, patCredential.email || existing.email, accountId);
    await this.writeCodexCredential(id, fileName, patCredential);
    const credentials = upsertCodexCredential(existing.codexCredentials ?? [], {
      accountId,
      fileName,
      groupName: existingMeta?.groupName ?? DEFAULT_CREDENTIAL_GROUP,
      planType: patCredential.plan_type,
      lastCreatedAt: now
    });
    const merged: Subaccount = {
      ...existing,
      email: patCredential.email || existing.email,
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
      remark: account.remark,
      groupName: normalizeSubaccountGroupName(account.groupName),
      chatgptAccountId: account.chatgptAccountId,
      proxy: account.proxy,
      registrationPassword: account.registrationPassword,
      registrationJobId: account.registrationJobId,
      registeredAt: account.registeredAt,
      registrationSource: account.registrationSource,
      registrationMethod: account.registrationMethod,
      cloakProfileId: account.cloakProfileId,
      cloakProfileName: account.cloakProfileName,
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
    const patCredential = parsePersonalAccessTokenCredential(credential);
    if (!patCredential) throw new Error('只允许保存 PAT 凭证');
    const dir = join(this.dataDir, CREDENTIAL_DIR, subaccountId);
    await mkdir(dir, { recursive: true });
    await writeFile(this.credentialPath(subaccountId, fileName), JSON.stringify(patCredential, null, 2), 'utf8');
  }

  private readCodexCredential(account: Subaccount, metadata: SubaccountCodexCredential): CodexCredentialJson | undefined {
    try {
      return parsePersonalAccessTokenCredential(
        JSON.parse(readFileSync(this.credentialPath(account.id, metadata.fileName), 'utf8'))
      );
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
    record.groupName !== normalizeSubaccountGroupName(record.groupName);
  const credentials: SubaccountCodexCredential[] = [];
  for (const item of record.codexCredentials ?? []) {
    const legacyCredential = parsePersonalAccessTokenCredential(item.credential);
    const accountId =
      legacyCredential?.account_id?.trim() || (typeof item.accountId === 'string' ? item.accountId.trim() : '');
    if (!accountId) {
      changed = true;
      continue;
    }
    const fileName = normalizeCredentialFileName(item.fileName, legacyCredential?.email ?? record.email, accountId);
    const credential = legacyCredential ?? await readPersonalAccessTokenCredentialFile(dataDir, record.id, fileName);
    if (!credential) {
      changed = true;
      await unlink(join(dataDir, CREDENTIAL_DIR, record.id, fileName)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
      continue;
    }
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
      planType: credential.plan_type ?? item.planType,
      lastQuota: item.lastQuota,
      lastQuotaAt: item.lastQuotaAt,
      lastCreatedAt: item.lastCreatedAt
    });
  }
  const legacySingleCredential = parsePersonalAccessTokenCredential(record.codexCredential);
  if (legacySingleCredential?.account_id) {
    changed = true;
    const accountId = legacySingleCredential.account_id.trim();
    const fileName = normalizeCredentialFileName(undefined, legacySingleCredential.email || record.email, accountId);
    await writeCredentialFile(dataDir, record.id, fileName, legacySingleCredential);
    credentials.push({
      accountId,
      fileName,
      groupName: DEFAULT_CREDENTIAL_GROUP,
      planType: legacySingleCredential.plan_type,
      lastQuota: record.lastQuota,
      lastQuotaAt: record.lastQuotaAt,
      lastCreatedAt: undefined
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
    chatgptAccountId: record.chatgptAccountId,
    webAccessToken: record.webAccessToken,
    sessionToken: record.sessionToken,
    proxy: record.proxy,
    registrationPassword: record.registrationPassword,
    registrationJobId: record.registrationJobId,
    registeredAt: record.registeredAt,
    registrationSource: record.registrationSource,
    registrationMethod: record.registrationMethod,
    cloakProfileId: record.cloakProfileId,
    cloakProfileName: record.cloakProfileName,
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
    chatgptAccountId: input.chatgptAccountId,
    webAccessToken: input.webAccessToken,
    sessionToken: input.sessionToken,
    proxy: input.proxy?.trim() || undefined,
    registrationPassword: input.registrationPassword,
    registrationJobId: input.registrationJobId?.trim() || undefined,
    registeredAt: input.registeredAt,
    registrationSource: input.registrationSource,
    registrationMethod: input.registrationMethod,
    cloakProfileId: input.cloakProfileId,
    cloakProfileName: input.cloakProfileName,
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

function normalizeCheckStatus(value: unknown): Subaccount['sessionTokenStatus'] {
  return value === 'valid' || value === 'invalid' || value === 'unknown' ? value : undefined;
}

function normalizeStoredSubaccountStatus(
  value: unknown,
  hasCredential: boolean,
  hasSession: boolean
): Subaccount['status'] {
  if (value === 'account_locked' || value === 'verification_required' || value === 'error') return value;
  if (value === 'pat_creating') return hasCredential ? 'codex_ready' : hasSession ? 'session_ready' : 'empty';
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
  if (account.webAccessToken || account.registrationPassword) return 'session_ready';
  return 'empty';
}

async function writeCredentialFile(
  dataDir: string,
  subaccountId: string,
  fileName: string,
  credential: CodexCredentialJson
): Promise<void> {
  const patCredential = parsePersonalAccessTokenCredential(credential);
  if (!patCredential) throw new Error('只允许保存 PAT 凭证');
  const dir = join(dataDir, CREDENTIAL_DIR, subaccountId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, fileName), JSON.stringify(patCredential, null, 2), 'utf8');
}

async function readPersonalAccessTokenCredentialFile(
  dataDir: string,
  subaccountId: string,
  fileName: string
): Promise<CodexCredentialJson | undefined> {
  try {
    return parsePersonalAccessTokenCredential(
      JSON.parse(await readFile(join(dataDir, CREDENTIAL_DIR, subaccountId, fileName), 'utf8'))
    );
  } catch {
    return undefined;
  }
}

function parsePersonalAccessTokenCredential(value: unknown): CodexCredentialJson | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record.type !== 'codex') return undefined;
  if (record.auth_mode !== 'personalAccessToken') return undefined;
  if (record.credential_source !== 'personal_access_token') return undefined;
  const accessToken = normalizeOptionalString(record.access_token);
  const personalAccessToken = normalizeOptionalString(record.personal_access_token);
  const accountId = normalizeOptionalString(record.account_id);
  const lastRefresh = normalizeOptionalString(record.last_refresh);
  const email = normalizeOptionalString(record.email);
  const expired = normalizeOptionalString(record.expired);
  if (!accessToken || !personalAccessToken || !accountId || !lastRefresh || !email || !expired) return undefined;
  if (accessToken !== personalAccessToken) return undefined;
  return {
    access_token: accessToken,
    personal_access_token: personalAccessToken,
    account_id: accountId,
    last_refresh: lastRefresh,
    email,
    type: 'codex',
    expired,
    plan_type: normalizeOptionalString(record.plan_type),
    auth_mode: 'personalAccessToken',
    credential_source: 'personal_access_token',
    credential_id: normalizeOptionalString(record.credential_id),
    chatgpt_user_id: normalizeOptionalString(record.chatgpt_user_id)
  };
}
