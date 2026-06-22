import type {
  CodexCredentialJson,
  CodexAuthRuntimeStatus,
  CodexQuotaSnapshot,
  Subaccount,
  SubaccountAuthLog,
  SubaccountView
} from '@team-manager/shared';
import { parseChatGptSessionInput } from '@team-manager/shared';
import { createCodexAuthSession, exchangeCodexCallback, type CodexAuthSession } from './codexAuth.js';
import {
  CodexAutoAuthError,
  createCodexAutoAuthExecutor,
  type CodexAutoAuthExecutor
} from './codexAutoAuth.js';
import { fetchCodexQuota } from './codexQuota.js';
import { ServiceError } from './teamService.js';
import { createTransport, type Transport } from './transport.js';
import { SubaccountStore } from './subaccountStore.js';

export interface CodexAuthStart {
  sessionId: string;
  authUrl: string;
  expiresAt: number;
  targetChatgptAccountId?: string;
}

export class SubaccountService {
  private readonly codexSessions = new Map<
    string,
    { subaccountId: string; session: CodexAuthSession; targetChatgptAccountId?: string }
  >();

  constructor(
    private readonly store: SubaccountStore,
    private readonly codexFetch: typeof fetch = fetch,
    private readonly quotaTransport: Transport = createTransport(),
    private readonly codexAutoAuth: CodexAutoAuthExecutor | undefined = createCodexAutoAuthExecutor()
  ) {}

  list(): SubaccountView[] {
    return this.store.list();
  }

  async getCodexAuthRuntimeStatus(): Promise<CodexAuthRuntimeStatus> {
    const workerUrl = process.env.TEAMMGR_CURL_CFFI_URL?.trim().replace(/\/+$/, '');
    if (!workerUrl) {
      return {
        workerConfigured: false,
        workerReachable: false,
        codexAutoAuth: false,
        flaresolverr: false,
        gongxiMail: false,
        phoneOtp: false,
        error: '未配置 TEAMMGR_CURL_CFFI_URL'
      };
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const response = await fetch(`${workerUrl}/health`, { signal: controller.signal }).finally(() =>
        clearTimeout(timer)
      );
      const data = (await response.json().catch(() => ({}))) as {
        capabilities?: Record<string, unknown>;
        phonePoolCount?: unknown;
        phonePoolError?: unknown;
      };
      const capabilities = data.capabilities ?? {};
      const workerReachable = response.ok;
      return {
        workerConfigured: true,
        workerReachable,
        codexAutoAuth: workerReachable && capabilities.codexAutoAuth === true,
        flaresolverr: capabilities.flaresolverr === true,
        gongxiMail: capabilities.gongxiMail === true,
        phoneOtp: capabilities.phoneOtp === true,
        phonePoolCount: typeof data.phonePoolCount === 'number' ? data.phonePoolCount : undefined,
        error:
          workerReachable
            ? typeof data.phonePoolError === 'string' && data.phonePoolError
              ? data.phonePoolError
              : undefined
            : `curl_cffi worker health 返回 HTTP ${response.status}`
      };
    } catch (e) {
      return {
        workerConfigured: true,
        workerReachable: false,
        codexAutoAuth: false,
        flaresolverr: false,
        gongxiMail: false,
        phoneOtp: false,
        error: (e as Error).message
      };
    }
  }

  async importSession(raw: unknown): Promise<SubaccountView> {
    let view: SubaccountView;
    try {
      view = await this.store.importSession(raw);
    } catch (e) {
      const message = (e as Error).message;
      if (message.startsWith('缺少 ') || message.startsWith('录入内容')) {
        throw new ServiceError(400, message);
      }
      throw e;
    }
    await this.store.appendLog(view.id, {
      phase: 'session_import',
      status: 'session_ready',
      message: '已录入子号 ChatGPT session JSON',
      data: { email: view.email, accountIdPresent: Boolean(view.chatgptAccountId) }
    });
    return view;
  }

  async importCodexCredential(raw: unknown): Promise<SubaccountView> {
    const input = parseCodexCredentialImportInput(raw);
    const view = await this.store.importCodexCredential(input.credential, {
      fileName: input.fileName,
      groupName: input.groupName
    });
    await this.store.appendLog(view.id, {
      phase: 'codex_credential_import',
      status: view.status,
      message: '已导入已有 Codex credential JSON',
      data: {
        email: view.email,
        accountId: input.credential.account_id,
        fileName: input.fileName,
        groupName: input.groupName,
        planType: input.credential.plan_type
      }
    });
    return view;
  }

  async updateLocalProfile(id: string, input: { label?: unknown; session?: unknown }): Promise<SubaccountView> {
    this.requireSubaccount(id);
    const label = typeof input.label === 'string' ? input.label.trim() : '';
    if (!label) throw new ServiceError(400, '缺少本地备注名');

    const session =
      input.session === undefined
        ? undefined
        : parseChatGptSessionInput(input.session);
    if (session && 'error' in session) throw new ServiceError(400, session.error);

    const updated = await this.store.updateLocalProfile(id, {
      label,
      session
    });
    if (!updated) throw new ServiceError(404, `子号不存在: ${id}`);

    await this.store.appendLog(id, {
      phase: 'local_profile_update',
      status: updated.status,
      message: input.session === undefined ? '已更新子号本地备注名' : '已更新子号本地备注名和 ChatGPT session',
      data: {
        email: updated.email,
        accountIdPresent: Boolean(updated.chatgptAccountId),
        sessionUpdated: input.session !== undefined
      }
    });
    return updated;
  }

  async remove(id: string): Promise<boolean> {
    return this.store.remove(id);
  }

  async startCodexAuth(id: string, targetChatgptAccountId?: string): Promise<CodexAuthStart> {
    this.requireSubaccount(id);
    const target = cleanTargetAccountId(targetChatgptAccountId);
    const session = createCodexAuthSession();
    this.codexSessions.set(session.id, { subaccountId: id, session, targetChatgptAccountId: target });
    await this.store.update(id, { status: 'codex_auth_pending', lastError: undefined });
    await this.store.appendLog(id, {
      phase: 'codex_auth_start',
      status: 'codex_auth_pending',
      message: '已创建 Codex Auth 授权 URL',
      data: { sessionId: session.id, expiresAt: session.expiresAt, targetChatgptAccountId: target }
    });
    return { sessionId: session.id, authUrl: session.authUrl, expiresAt: session.expiresAt, targetChatgptAccountId: target };
  }

  async completeCodexAuth(id: string, sessionId: string, callbackUrl: string): Promise<SubaccountView> {
    this.requireSubaccount(id);
    const entry = this.codexSessions.get(sessionId);
    if (!entry || entry.subaccountId !== id) throw new ServiceError(404, 'Codex Auth 会话不存在或已过期');

    try {
      const credential = await exchangeCodexCallback({
        callbackUrl,
        session: entry.session,
        fetchImpl: this.codexFetch
      });
      assertCredentialMatchesTarget(credential, entry.targetChatgptAccountId);
      const updated = await this.store.saveCodexCredential(id, credential);
      if (!updated) throw new ServiceError(404, `子号不存在: ${id}`);
      this.codexSessions.delete(sessionId);
      await this.store.appendLog(id, {
        phase: 'codex_auth_callback',
        status: 'codex_ready',
        message: 'Codex Auth 授权完成，已生成凭证 JSON',
        data: {
          email: credential.email,
          accountIdPresent: Boolean(credential.account_id),
          accountId: credential.account_id,
          targetChatgptAccountId: entry.targetChatgptAccountId
        }
      });
      return updated;
    } catch (e) {
      await this.store.update(id, { status: 'error', lastError: (e as Error).message });
      await this.store.appendLog(id, {
        phase: 'codex_auth_callback',
        status: 'error',
        message: (e as Error).message,
        data: { sessionId }
      });
      throw e;
    }
  }

  async autoCompleteCodexAuth(id: string, targetChatgptAccountId?: string): Promise<SubaccountView> {
    const subaccount = this.requireSubaccount(id);
    if (!this.codexAutoAuth) throw new ServiceError(501, '未配置 Codex 自动授权 worker');
    const target = cleanTargetAccountId(targetChatgptAccountId);
    const session = createCodexAuthSession({ loginHint: subaccount.email });

    await this.store.update(id, { status: 'codex_auth_pending', lastError: undefined });
    await this.store.appendLog(id, {
      phase: 'codex_auto_auth_start',
      status: 'codex_auth_pending',
      message: '已启动 Codex 自动授权',
      data: { email: subaccount.email, sessionId: session.id, expiresAt: session.expiresAt, targetChatgptAccountId: target }
    });

    try {
      const result = await this.codexAutoAuth.complete({
        email: subaccount.email,
        session,
        targetChatgptAccountId: target
      });
      assertCredentialMatchesTarget(result.credential, target);
      const updated = await this.store.saveCodexCredential(id, result.credential);
      if (!updated) throw new ServiceError(404, `子号不存在: ${id}`);
      await this.store.appendLog(id, {
        phase: 'codex_auto_auth_complete',
        status: 'codex_ready',
        message: 'Codex 自动授权完成，已生成凭证 JSON',
        data: {
          email: result.credential.email,
          accountIdPresent: Boolean(result.credential.account_id),
          accountId: result.credential.account_id,
          targetChatgptAccountId: target,
          callbackUrlPresent: Boolean(result.callbackUrl),
          eventCount: result.events.length,
          phases: result.events.map((event) => event.phase).filter(Boolean)
        }
      });
      return updated;
    } catch (e) {
      const status = e instanceof CodexAutoAuthError && e.status === 'verification_required' ? 'verification_required' : 'error';
      await this.store.update(id, { status, lastError: (e as Error).message });
      await this.store.appendLog(id, {
        phase: 'codex_auto_auth_complete',
        status,
        message: (e as Error).message,
        data:
          e instanceof CodexAutoAuthError
            ? {
                workerStatus: e.status,
                challenge: e.challenge,
                eventCount: e.events.length,
                phases: e.events.map((event) => event.phase).filter(Boolean)
              }
            : undefined
      });
      throw e;
    }
  }

  getCodexCredential(id: string, targetChatgptAccountId?: string): CodexCredentialJson {
    this.requireSubaccount(id);
    const target = cleanTargetAccountId(targetChatgptAccountId);
    const credential = target
      ? this.store.getCodexCredentialForAccount(id, target)
      : this.store.getCodexCredential(id);
    if (!credential) {
      throw new ServiceError(404, target ? '子号还没有该 Team 的 Codex 凭证 JSON' : '子号还没有 Codex 凭证 JSON');
    }
    return credential;
  }

  async refreshQuota(id: string, targetChatgptAccountId?: string): Promise<CodexQuotaSnapshot> {
    const credential = this.getCodexCredential(id, targetChatgptAccountId);
    const snapshot = await fetchCodexQuota(credential, this.quotaTransport);
    await this.store.saveQuotaSnapshot(id, credential.account_id, snapshot);
    await this.store.appendLog(id, {
      phase: 'quota_refresh',
      status: snapshot.status,
      message: snapshot.error ?? 'Codex 额度查询完成',
      data: {
        planType: snapshot.planType,
        windowCount: snapshot.windows.length,
        accountId: credential.account_id
      }
    });
    if (snapshot.status === 'error') {
      await this.store.update(id, { status: 'error', lastError: snapshot.error ?? 'Codex 额度查询失败' });
    }
    return snapshot;
  }

  listLogs(id?: string): SubaccountAuthLog[] {
    if (id) this.requireSubaccount(id);
    return this.store.listLogs(id);
  }

  private requireSubaccount(id: string): Subaccount {
    const subaccount = this.store.get(id);
    if (!subaccount) throw new ServiceError(404, `子号不存在: ${id}`);
    return subaccount;
  }
}

function cleanTargetAccountId(value?: string): string | undefined {
  const target = value?.trim();
  return target || undefined;
}

function parseCodexCredentialImportInput(raw: unknown): {
  credential: CodexCredentialJson;
  fileName?: string;
  groupName?: string;
} {
  if (!raw || typeof raw !== 'object') {
    throw new ServiceError(400, '录入内容必须是 Codex credential JSON');
  }
  const record = raw as Record<string, unknown>;
  if (record.credential && typeof record.credential === 'object') {
    return {
      credential: parseCodexCredentialInput(record.credential),
      fileName: readOptionalString(record, 'fileName'),
      groupName: readOptionalString(record, 'groupName')
    };
  }
  return { credential: parseCodexCredentialInput(raw) };
}

function parseCodexCredentialInput(raw: unknown): CodexCredentialJson {
  if (!raw || typeof raw !== 'object') {
    throw new ServiceError(400, '录入内容必须是 Codex credential JSON');
  }
  const record = raw as Record<string, unknown>;
  const credential: CodexCredentialJson = {
    id_token: readRequiredString(record, 'id_token'),
    access_token: readRequiredString(record, 'access_token'),
    refresh_token: readRequiredString(record, 'refresh_token'),
    account_id: readRequiredString(record, 'account_id'),
    last_refresh: readRequiredString(record, 'last_refresh'),
    email: readRequiredString(record, 'email'),
    type: readRequiredString(record, 'type') as 'codex',
    expired: readRequiredString(record, 'expired'),
    plan_type: readOptionalString(record, 'plan_type')
  };
  if (credential.type !== 'codex') throw new ServiceError(400, 'Codex credential type 必须是 codex');
  return credential;
}

function readRequiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) throw new ServiceError(400, `Codex 凭证缺少 ${key}`);
  return value.trim();
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function assertCredentialMatchesTarget(credential: CodexCredentialJson, target?: string): void {
  if (!target) return;
  if (credential.account_id !== target) {
    throw new ServiceError(
      409,
      `Codex 授权选择的 workspace 与目标不一致：目标 ${target}，实际 ${credential.account_id || '空'}`
    );
  }
}
