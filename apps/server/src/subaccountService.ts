import type {
  CodexCredentialJson,
  CodexAuthRuntimeStatus,
  CodexQuotaSnapshot,
  Subaccount,
  SubaccountAuthLog,
  SubaccountStatus,
  SubaccountView
} from '@team-manager/shared';
import { parseChatGptSessionInput } from '@team-manager/shared';
import { createCodexAuthSession, exchangeCodexCallback, type CodexAuthSession } from './codexAuth.js';
import {
  CodexAutoAuthError,
  createCodexAutoAuthExecutor,
  type CodexAutoAuthEvent,
  type CodexAutoAuthExecutor
} from './codexAutoAuth.js';
import {
  SubaccountRegistrationError,
  createSubaccountRegistrationExecutor,
  type SubaccountRegistrationExecutor
} from './subaccountRegistration.js';
import { fetchCodexQuota } from './codexQuota.js';
import { ServiceError } from './teamService.js';
import { ChatGptApi, ChatGptApiError, type CodexPersonalAccessTokenResponse } from './chatgptApi.js';
import { createTransport, type Transport } from './transport.js';
import { SubaccountStore } from './subaccountStore.js';

const CODEX_PAT_NAME = 'team-manager';
const CODEX_PAT_TTL_SECONDS = 30 * 24 * 60 * 60;
const CODEX_LOCAL_ACCESS_SCOPE = 'chatgpt.workspace.feature.allow-codex-local-access.access';

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
    private readonly codexAutoAuth: CodexAutoAuthExecutor | undefined = createCodexAutoAuthExecutor(),
    private readonly registration: SubaccountRegistrationExecutor | undefined = createSubaccountRegistrationExecutor(),
    private readonly webTransport: Transport = createTransport()
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
        subaccountRegistration: false,
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
        phonePoolExhaustedCount?: unknown;
        phonePoolError?: unknown;
      };
      const capabilities = data.capabilities ?? {};
      const workerReachable = response.ok;
      return {
        workerConfigured: true,
        workerReachable,
        codexAutoAuth: workerReachable && capabilities.codexAutoAuth === true,
        subaccountRegistration: workerReachable && capabilities.subaccountRegistration === true,
        flaresolverr: capabilities.flaresolverr === true,
        gongxiMail: capabilities.gongxiMail === true,
        phoneOtp: capabilities.phoneOtp === true,
        phonePoolCount: typeof data.phonePoolCount === 'number' ? data.phonePoolCount : undefined,
        phonePoolExhaustedCount:
          typeof data.phonePoolExhaustedCount === 'number' ? data.phonePoolExhaustedCount : undefined,
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
        subaccountRegistration: false,
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

  async removeCodexCredential(id: string, targetChatgptAccountId?: string): Promise<SubaccountView> {
    const subaccount = this.requireSubaccount(id);
    const target = cleanTargetAccountId(targetChatgptAccountId);
    if (!target) throw new ServiceError(400, '缺少 chatgptAccountId');
    const credential = (subaccount.codexCredentials ?? []).find((item) => item.accountId.trim() === target);
    if (!credential) throw new ServiceError(404, '子号还没有该 Team 的 Codex 凭证 JSON');

    const updated = await this.store.removeCodexCredential(id, target);
    if (!updated) throw new ServiceError(404, '子号还没有该 Team 的 Codex 凭证 JSON');
    await this.store.appendLog(id, {
      phase: 'codex_credential_delete',
      status: updated.status,
      message: '已删除该 Team workspace 的 Codex 凭证',
      data: {
        accountId: target,
        fileName: credential.fileName,
        groupName: credential.groupName,
        remainingCredentialCount: updated.codexCredentials.length
      }
    });
    return updated;
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

    const streamedEvents: CodexAutoAuthEvent[] = [];
    try {
      const result = await this.codexAutoAuth.complete({
        email: subaccount.email,
        session,
        targetChatgptAccountId: target,
        password: subaccount.registrationPassword?.trim() || undefined,
        onEvent: async (event) => {
          streamedEvents.push(event);
          await this.appendCodexAutoAuthEventLog(id, event, target, streamedEvents.length);
        }
      });
      assertCredentialMatchesTarget(result.credential, target);
      const updated = await this.store.saveCodexCredential(id, result.credential);
      if (!updated) throw new ServiceError(404, `子号不存在: ${id}`);
      await this.appendCodexAutoAuthEventLogs(id, result.events.slice(streamedEvents.length), target, streamedEvents.length);
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
      const status = e instanceof CodexAutoAuthError ? subaccountStatusFromWorkerStatus(e.status) : 'error';
      await this.store.update(id, { status, lastError: (e as Error).message });
      if (e instanceof CodexAutoAuthError) {
        await this.appendCodexAutoAuthEventLogs(id, e.events.slice(streamedEvents.length), target, streamedEvents.length);
      }
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
      if (e instanceof CodexAutoAuthError) throw new ServiceError(502, e.message);
      throw e;
    }
  }

  async createPersonalAccessTokenCredential(
    id: string,
    targetChatgptAccountId?: string
  ): Promise<SubaccountView> {
    const subaccount = this.requireSubaccount(id);
    const target = cleanTargetAccountId(targetChatgptAccountId);
    if (!target) throw new ServiceError(400, '缺少 chatgptAccountId');
    if (!subaccount.webAccessToken?.trim()) {
      throw new ServiceError(400, '子号缺少 ChatGPT Web session，无法创建个人访问令牌');
    }

    await this.store.update(id, { status: 'codex_auth_pending', lastError: undefined });
    await this.store.appendLog(id, {
      phase: 'codex_pat_create_start',
      status: 'codex_auth_pending',
      message: '已开始通过子号 Web session 创建 Codex 个人访问令牌',
      data: { targetChatgptAccountId: target }
    });

    try {
      const api = new ChatGptApi(
        {
          accountId: target,
          accessToken: subaccount.webAccessToken
        },
        this.webTransport
      );
      const response = await api.createCodexPersonalAccessToken({
        name: CODEX_PAT_NAME,
        scopes: [CODEX_LOCAL_ACCESS_SCOPE],
        ttl: CODEX_PAT_TTL_SECONDS
      });
      const credential = codexCredentialFromPersonalAccessTokenResponse(response, subaccount.email, target);
      const updated = await this.store.saveCodexCredential(id, credential);
      if (!updated) throw new ServiceError(404, `子号不存在: ${id}`);
      await this.store.appendLog(id, {
        phase: 'codex_pat_create_complete',
        status: 'codex_ready',
        message: '已创建 Codex 个人访问令牌并保存凭证 JSON',
        data: {
          email: credential.email,
          accountId: credential.account_id,
          issuedAccountId: credential.issued_account_id,
          credentialIdPresent: Boolean(credential.credential_id),
          expiresAt: credential.expired
        }
      });
      return updated;
    } catch (e) {
      const message =
        e instanceof ChatGptApiError
          ? `创建 Codex 个人访问令牌失败: HTTP ${e.status} ${trimForLog(e.body)}`
          : (e as Error).message;
      await this.store.update(id, { status: 'error', lastError: message });
      await this.store.appendLog(id, {
        phase: 'codex_pat_create_complete',
        status: 'error',
        message,
        data: { targetChatgptAccountId: target }
      });
      if (e instanceof ServiceError) throw e;
      if (e instanceof ChatGptApiError) throw new ServiceError(e.status >= 400 && e.status < 500 ? e.status : 502, message);
      throw e;
    }
  }

  async registerNewSubaccount(input: { targetChatgptAccountId?: string; mailGroup?: string }): Promise<SubaccountView> {
    if (!this.registration) throw new ServiceError(501, '未配置子号自动注册 worker');
    const target = cleanTargetAccountId(input.targetChatgptAccountId);
    const mailGroup = cleanOptionalString(input.mailGroup);
    const session = createCodexAuthSession();

    try {
      const result = await this.registration.register({
        session,
        targetChatgptAccountId: target,
        mailGroup
      });
      if (result.credential) assertCredentialMatchesTarget(result.credential, target);

      const registered = await this.store.saveRegisteredSubaccount({
        email: result.email,
        password: result.password,
        source: mailGroup ? `gongxi:${mailGroup}` : 'gongxi',
        status: result.credential ? 'codex_ready' : 'session_ready'
      });
      const updated = result.credential
        ? await this.store.saveCodexCredential(registered.id, result.credential)
        : registered;
      if (!updated) throw new ServiceError(404, `子号不存在: ${registered.id}`);

      await this.store.appendLog(registered.id, {
        phase: 'subaccount_registration_complete',
        status: updated.status,
        message: result.credential ? '子号自动注册并完成 Codex 授权' : '子号自动注册完成',
        data: {
          email: result.email,
          passwordStored: true,
          callbackUrlPresent: Boolean(result.callbackUrl),
          targetChatgptAccountId: target,
          mailGroup,
          eventCount: result.events.length,
          phases: result.events.map((event) => event.phase).filter(Boolean)
        }
      });
      return updated;
    } catch (e) {
      if (e instanceof SubaccountRegistrationError && e.email && e.password) {
        const status = subaccountStatusFromWorkerStatus(e.status);
        const registered = await this.store.saveRegisteredSubaccount({
          email: e.email,
          password: e.password,
          source: mailGroup ? `gongxi:${mailGroup}` : 'gongxi',
          status,
          lastError: e.message
        });
        await this.store.appendLog(registered.id, {
          phase: 'subaccount_registration_complete',
          status,
          message: e.message,
          data: {
            workerStatus: e.status,
            challenge: e.challenge,
            passwordStored: true,
            targetChatgptAccountId: target,
            mailGroup,
            eventCount: e.events.length,
            phases: e.events.map((event) => event.phase).filter(Boolean)
          }
        });
        return registered;
      }
      if (e instanceof SubaccountRegistrationError) throw new ServiceError(502, e.message);
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

  private async appendCodexAutoAuthEventLogs(
    id: string,
    events: CodexAutoAuthEvent[],
    targetChatgptAccountId?: string,
    offset = 0
  ): Promise<void> {
    for (const [index, event] of events.entries()) {
      await this.appendCodexAutoAuthEventLog(id, event, targetChatgptAccountId, offset + index + 1);
    }
  }

  private async appendCodexAutoAuthEventLog(
    id: string,
    event: CodexAutoAuthEvent,
    targetChatgptAccountId: string | undefined,
    order: number
  ): Promise<void> {
    const phase = event.phase?.trim() || 'codex_auto_auth_event';
    const httpStatus = typeof event.status === 'number' ? event.status : undefined;
    await this.store.appendLog(id, {
      phase,
      status: eventStatusLabel(httpStatus),
      message: event.message?.trim() || `自动授权阶段：${phase}`,
      data: {
        order,
        targetChatgptAccountId,
        httpStatus,
        pageType: event.pageType,
        continueUrlPresent: Boolean(event.continueUrl),
        locationPresent: Boolean(event.location)
      }
    });
  }

  private requireSubaccount(id: string): Subaccount {
    const subaccount = this.store.get(id);
    if (!subaccount) throw new ServiceError(404, `子号不存在: ${id}`);
    return subaccount;
  }
}

function subaccountStatusFromWorkerStatus(status: string): SubaccountStatus {
  if (status === 'account_locked') return 'account_locked';
  if (status === 'verification_required') return 'verification_required';
  return 'error';
}

function eventStatusLabel(httpStatus?: number): string {
  if (httpStatus === undefined) return 'ok';
  return httpStatus >= 400 ? 'error' : 'ok';
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

function cleanOptionalString(value?: string): string | undefined {
  const cleaned = value?.trim();
  return cleaned || undefined;
}

function parseCodexCredentialInput(raw: unknown): CodexCredentialJson {
  if (!raw || typeof raw !== 'object') {
    throw new ServiceError(400, '录入内容必须是 Codex credential JSON');
  }
  const record = raw as Record<string, unknown>;
  const accessToken = readOptionalString(record, 'access_token') ?? readOptionalString(record, 'personal_access_token');
  if (!accessToken) throw new ServiceError(400, 'Codex 凭证缺少 access_token');
  const refreshToken = readOptionalString(record, 'refresh_token');
  const idToken = readOptionalString(record, 'id_token');
  const personalAccessToken = readOptionalString(record, 'personal_access_token');
  const isPersonalAccessToken =
    readOptionalString(record, 'auth_mode') === 'personalAccessToken' ||
    readOptionalString(record, 'credential_source') === 'personal_access_token' ||
    Boolean(personalAccessToken) ||
    (!refreshToken && !idToken && accessToken.startsWith('at-'));
  if (!isPersonalAccessToken && !idToken) throw new ServiceError(400, 'Codex 凭证缺少 id_token');
  if (!isPersonalAccessToken && !refreshToken) throw new ServiceError(400, 'Codex 凭证缺少 refresh_token');

  const credential: CodexCredentialJson = {
    ...(idToken ? { id_token: idToken } : {}),
    access_token: accessToken,
    ...(refreshToken ? { refresh_token: refreshToken } : {}),
    account_id: readRequiredString(record, 'account_id'),
    last_refresh: readRequiredString(record, 'last_refresh'),
    email: readRequiredString(record, 'email'),
    type: readRequiredString(record, 'type') as 'codex',
    expired: readRequiredString(record, 'expired'),
    plan_type: readOptionalString(record, 'plan_type'),
    auth_mode: isPersonalAccessToken ? 'personalAccessToken' : readOptionalString(record, 'auth_mode') as CodexCredentialJson['auth_mode'],
    credential_source: isPersonalAccessToken
      ? 'personal_access_token'
      : readOptionalString(record, 'credential_source') as CodexCredentialJson['credential_source'],
    personal_access_token: isPersonalAccessToken ? personalAccessToken ?? accessToken : undefined,
    credential_id: readOptionalString(record, 'credential_id'),
    chatgpt_user_id: readOptionalString(record, 'chatgpt_user_id'),
    issued_account_id: readOptionalString(record, 'issued_account_id')
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

function codexCredentialFromPersonalAccessTokenResponse(
  response: CodexPersonalAccessTokenResponse,
  fallbackEmail: string,
  targetAccountId?: string,
  now: Date = new Date()
): CodexCredentialJson {
  const accessToken = response.access_token?.trim();
  if (!accessToken) throw new ServiceError(502, '个人访问令牌响应缺少 access_token');
  const issuedAccountId = response.workspace_id?.trim();
  if (!issuedAccountId) throw new ServiceError(502, '个人访问令牌响应缺少 workspace_id');
  const accountId = targetAccountId?.trim() || issuedAccountId;
  const email = response.creator_user_email?.trim() || fallbackEmail;
  const lastRefresh = epochSecondsToIso(response.created_at) ?? now.toISOString();
  const expired = epochSecondsToIso(response.expires_at);
  if (!expired) throw new ServiceError(502, '个人访问令牌响应缺少 expires_at');

  return {
    access_token: accessToken,
    personal_access_token: accessToken,
    account_id: accountId,
    last_refresh: lastRefresh,
    email,
    type: 'codex',
    expired,
    auth_mode: 'personalAccessToken',
    credential_source: 'personal_access_token',
    credential_id: response.credential_id,
    chatgpt_user_id: response.owner_user_id,
    issued_account_id: issuedAccountId === accountId ? undefined : issuedAccountId
  };
}

function epochSecondsToIso(value: unknown): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function trimForLog(value: string): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length > 200 ? `${trimmed.slice(0, 200)}...` : trimmed;
}
