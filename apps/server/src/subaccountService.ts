import type {
  CodexCredentialJson,
  CodexAuthRuntimeStatus,
  CodexQuotaSnapshot,
  Subaccount,
  SubaccountAuthLog,
  SubaccountRegistrationJobView,
  SubaccountStatus,
  SubaccountView
} from '@team-manager/shared';
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
import { SubaccountRegistrationJobStore } from './subaccountRegistrationJobStore.js';
import { fetchCodexQuota } from './codexQuota.js';
import { ServiceError } from './teamService.js';
import {
  ChatGptApi,
  ChatGptApiError,
  type CodexPersonalAccessTokenResponse
} from './chatgptApi.js';
import {
  ChatGptWebSessionError,
  fetchWorkspaceExchangeSessionFromSessionToken,
  fetchWorkspaceWebAccessTokenFromSessionToken,
  fetchWorkspaceWebSessionFromSessionToken,
  resolveChatGptSessionImportInput,
  type ChatGptWorkspaceSession
} from './chatgptWebSession.js';
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
  private registrationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: SubaccountStore,
    private readonly registrationJobs: SubaccountRegistrationJobStore,
    private readonly codexFetch: typeof fetch = fetch,
    private readonly quotaTransport: Transport = createTransport(),
    private readonly codexAutoAuth: CodexAutoAuthExecutor | undefined = createCodexAutoAuthExecutor(),
    private readonly registration: SubaccountRegistrationExecutor | undefined = createSubaccountRegistrationExecutor(),
    private readonly webTransport: Transport = createTransport()
  ) {}

  list(): SubaccountView[] {
    return this.store.list();
  }

  listRegistrationJobs(): SubaccountRegistrationJobView[] {
    return this.registrationJobs.list();
  }

  async startSubaccountRegistration(input: {
    mailGroup?: string;
    email?: string;
    password?: string;
    resumeExisting?: boolean;
  }): Promise<SubaccountRegistrationJobView> {
    if (!this.registration) throw new ServiceError(501, '未配置子号自动注册 worker');
    const job = await this.registrationJobs.create();
    this.registrationQueue = this.registrationQueue
      .then(() => this.runSubaccountRegistrationJob(job.id, input))
      .catch((error) => {
        console.error(`[team-manager] 自动注册任务 ${job.id} 后台执行失败:`, error);
      });
    return job;
  }

  async retrySubaccountRegistration(jobId: string): Promise<SubaccountRegistrationJobView> {
    const job = this.registrationJobs.get(jobId);
    if (!job) throw new ServiceError(404, `自动注册任务不存在: ${jobId}`);
    if (job.status !== 'failed' && job.status !== 'interrupted') {
      throw new ServiceError(409, '只有失败或中断的注册任务可以重试');
    }
    const subaccount = job.subaccountId ? this.store.get(job.subaccountId) : undefined;
    const retryInput =
      subaccount?.registrationPassword
        ? {
            email: subaccount.email,
            password: subaccount.registrationPassword,
            resumeExisting: false
          }
        : {};
    const reset = await this.registrationJobs.update(jobId, {
      status: 'queued',
      phase: 'registration_queued',
      message: retryInput.email ? `已重新加入队列，将重试邮箱 ${retryInput.email}` : '已重新加入自动注册队列',
      progress: 0,
      error: undefined,
      completedAt: undefined
    });
    this.registrationQueue = this.registrationQueue
      .then(() => this.runSubaccountRegistrationJob(jobId, retryInput))
      .catch((error) => {
        console.error(`[team-manager] 自动注册重试任务 ${jobId} 后台执行失败:`, error);
      });
    return reset;
  }

  private async runSubaccountRegistrationJob(
    jobId: string,
    input: { mailGroup?: string; email?: string; password?: string; resumeExisting?: boolean }
  ): Promise<void> {
    await this.registrationJobs.update(jobId, {
      status: 'running',
      phase: 'registration_starting',
      message: '正在准备注册环境',
      progress: 2
    });
    try {
      const registered = await this.registerNewSubaccount({
        ...input,
        onEvent: async (event) => {
          const progress = registrationProgressFromEvent(event);
          if (!progress) return;
          await this.registrationJobs.update(jobId, progress);
        }
      });
      const failed = Boolean(registered.lastError) || !registered.hasWebSession;
      await this.registrationJobs.update(jobId, {
        status: failed ? 'failed' : 'succeeded',
        phase: failed ? 'registration_failed' : 'registration_complete',
        message: failed ? registered.lastError ?? '自动注册未取得有效 Web Session' : '自动注册完成',
        progress: 100,
        email: registered.email,
        subaccountId: registered.id,
        completedAt: Date.now(),
        error: failed ? registered.lastError ?? 'registration_incomplete' : undefined
      });
    } catch (error) {
      await this.registrationJobs.update(jobId, {
        status: 'failed',
        phase: 'registration_failed',
        message: (error as Error).message,
        progress: 100,
        completedAt: Date.now(),
        error: (error as Error).message
      });
    }
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
    const payload = parseSubaccountSessionImportPayload(raw);
    const input = await this.resolveSubaccountSessionInput(payload.session);
    const view = await this.store.importSession(input.session, {
      ...(payload.hasRemark ? { remark: payload.remark } : {}),
      ...(payload.hasProxy ? { proxy: payload.proxy } : {})
    });
    await this.store.appendLog(view.id, {
      phase: 'session_import',
      status: 'session_ready',
      message: '已录入子号 ChatGPT session JSON',
      data: {
        email: view.email,
        accountIdPresent: Boolean(view.chatgptAccountId),
        localProfilePresent: payload.hasRemark || payload.hasProxy,
        proxyPresent: Boolean(view.proxy),
        inputType: input.type
      }
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

  async updateLocalProfile(id: string, input: { remark?: unknown; proxy?: unknown; session?: unknown }): Promise<SubaccountView> {
    this.requireSubaccount(id);
    const hasRemark = Object.prototype.hasOwnProperty.call(input, 'remark');
    const hasProxy = Object.prototype.hasOwnProperty.call(input, 'proxy');
    if (hasRemark && input.remark !== undefined && typeof input.remark !== 'string') {
      throw new ServiceError(400, '备注必须是字符串');
    }
    if (hasProxy && input.proxy !== undefined && typeof input.proxy !== 'string') {
      throw new ServiceError(400, '代理地址必须是字符串');
    }
    const remark = typeof input.remark === 'string' ? input.remark.trim() || undefined : undefined;
    const proxy = typeof input.proxy === 'string' ? input.proxy.trim() || undefined : undefined;

    const sessionInput =
      input.session === undefined
        ? undefined
        : await this.resolveSubaccountSessionInput(input.session);

    const updated = await this.store.updateLocalProfile(id, {
      ...(hasRemark ? { remark } : {}),
      ...(hasProxy ? { proxy } : {}),
      session: sessionInput?.session
    });
    if (!updated) throw new ServiceError(404, `子号不存在: ${id}`);

    await this.store.appendLog(id, {
      phase: 'local_profile_update',
      status: updated.status,
      message: input.session === undefined ? '已更新子号本地备注' : '已更新子号本地备注和 ChatGPT session',
      data: {
        email: updated.email,
        accountIdPresent: Boolean(updated.chatgptAccountId),
        sessionUpdated: input.session !== undefined,
        proxyUpdated: hasProxy,
        inputType: sessionInput?.type
      }
    });
    return updated;
  }

  async refreshWebAccount(id: string): Promise<SubaccountView> {
    const initial = this.requireSubaccount(id);
    const checkedAt = Date.now();
    const errors: string[] = [];
    let accessToken = initial.webAccessToken?.trim() ?? '';
    let sessionResponse: Record<string, unknown> | undefined;
    let meResponse: Record<string, unknown> | undefined;
    let profileResponse: Record<string, unknown> | undefined;
    let notificationsResponse: Record<string, unknown> | undefined;
    let creditsResponse: Record<string, unknown> | undefined;
    let patch: Partial<Subaccount> = { lastRefreshAt: checkedAt };

    if (!initial.sessionToken?.trim()) {
      errors.push('Session JSON 缺少 sessionToken，无法验证 Session Cookie');
      patch.sessionTokenStatus = 'invalid';
      patch.sessionTokenCheckedAt = checkedAt;
    } else if (!initial.chatgptAccountId?.trim()) {
      errors.push('Session JSON 缺少 account.id，无法刷新 Web Session');
      patch.sessionTokenStatus = 'invalid';
      patch.sessionTokenCheckedAt = checkedAt;
    } else {
      try {
        sessionResponse = await fetchWorkspaceWebSessionFromSessionToken(
          this.webTransport,
          initial.sessionToken,
          initial.chatgptAccountId,
          initial.proxy
        );
        accessToken = readSessionAccessToken(sessionResponse);
        patch = {
          ...patch,
          webAccessToken: accessToken,
          sessionTokenStatus: 'valid',
          sessionTokenCheckedAt: checkedAt
        };
      } catch (error) {
        errors.push(`Session Cookie 验证失败: ${fullErrorMessage(error)}`);
        patch.sessionTokenStatus = 'invalid';
        patch.sessionTokenCheckedAt = checkedAt;
      }
    }

    if (!accessToken || !initial.chatgptAccountId?.trim()) {
      errors.push('缺少可用于 backend-api 的 Web Access Token 或 account.id');
      patch.webAccessTokenStatus = 'invalid';
      patch.webAccessTokenCheckedAt = checkedAt;
    } else {
      const api = this.webApiFor({ ...initial, ...patch, webAccessToken: accessToken }, async (response, token) => {
        sessionResponse = response;
        accessToken = token;
        patch = {
          ...patch,
          webAccessToken: token,
          sessionTokenStatus: 'valid',
          sessionTokenCheckedAt: Date.now()
        };
      });

      let userId = initial.chatgptUserId;
      try {
        meResponse = await api.getMe();
        userId = readOptionalString(meResponse, 'id') ?? userId;
        const remoteEmail = readOptionalString(meResponse, 'email');
        patch = {
          ...patch,
          webAccessToken: accessToken,
          webAccessTokenStatus: 'valid',
          webAccessTokenCheckedAt: Date.now(),
          chatgptUserId: userId,
          remoteDisplayName: readOptionalString(meResponse, 'name') ?? initial.remoteDisplayName,
          remotePictureUrl: readOptionalString(meResponse, 'picture') ?? initial.remotePictureUrl,
          personalProfileCachedAt: Date.now()
        };
        if (remoteEmail && remoteEmail.toLowerCase() !== initial.email.toLowerCase()) {
          errors.push(`个人资料邮箱与子号不一致: ${remoteEmail} != ${initial.email}`);
        }
      } catch (error) {
        errors.push(`个人资料同步失败: ${fullErrorMessage(error)}`);
        if (error instanceof ChatGptApiError && error.status === 401) patch.webAccessTokenStatus = 'invalid';
        patch.webAccessTokenCheckedAt = Date.now();
      }

      if (userId) {
        try {
          profileResponse = await api.getPersonalProfile(userId);
          patch = { ...patch, ...personalProfilePatch(profileResponse, Date.now()) };
        } catch (error) {
          errors.push(`用户名资料读取失败: ${fullErrorMessage(error)}`);
        }
      }

      try {
        notificationsResponse = await api.getNotificationSettings();
        patch = { ...patch, ...marketingNotificationPatch(notificationsResponse, Date.now()) };
      } catch (error) {
        errors.push(`营销通知读取失败: ${fullErrorMessage(error)}`);
      }

      try {
        creditsResponse = await api.getRateLimitResetCredits();
        patch.rateLimitResetCredits = rateLimitResetCreditsFromResponse(creditsResponse, Date.now());
      } catch (error) {
        errors.push(`用量限制读取失败: ${fullErrorMessage(error)}`);
      }
    }

    patch.lastRefreshAt = Date.now();
    patch.lastError = errors.length ? errors.join('\n') : undefined;
    const updated = await this.store.update(id, patch);
    if (!updated) throw new ServiceError(404, `子号不存在: ${id}`);
    await this.store.appendLog(id, {
      phase: 'web_account_refresh',
      status: errors.length ? 'partial' : 'success',
      message: errors.length ? '子号 Web 账号同步完成，但存在失败步骤' : '子号 Web 账号同步完成',
      data: {
        email: initial.email,
        accountId: initial.chatgptAccountId,
        session: sessionResponse,
        me: meResponse,
        profile: profileResponse,
        notifications: notificationsResponse,
        rateLimitResetCredits: creditsResponse,
        errors
      }
    });
    return updated;
  }

  async setMarketingNotifications(
    id: string,
    input: { push?: boolean; email?: boolean }
  ): Promise<SubaccountView> {
    const subaccount = this.requireSubaccount(id);
    const api = this.webApiFor(subaccount);
    try {
      const response = await api.setMarketingNotifications(input);
      const updated = await this.store.update(id, {
        ...marketingNotificationPatch(response, Date.now()),
        webAccessTokenStatus: 'valid',
        webAccessTokenCheckedAt: Date.now(),
        lastError: undefined
      });
      if (!updated) throw new ServiceError(404, `子号不存在: ${id}`);
      await this.store.appendLog(id, {
        phase: 'personal_settings_update',
        status: 'success',
        message: '已修改营销通知设置',
        data: { input, response }
      });
      return updated;
    } catch (error) {
      await this.persistWebRequestError(id, 'personal_settings_update', '修改营销通知设置失败', error, { input });
      throw asServiceError(error);
    }
  }

  async setMemoryEnabled(id: string, enabled: boolean): Promise<SubaccountView> {
    const subaccount = this.requireSubaccount(id);
    const api = this.webApiFor(subaccount);
    try {
      const response = await api.setMemoryEnabled(enabled);
      const remoteValue = response.m3m;
      const updated = await this.store.update(id, {
        memoryEnabled: typeof remoteValue === 'boolean' ? remoteValue : enabled,
        memoryCachedAt: Date.now(),
        webAccessTokenStatus: 'valid',
        webAccessTokenCheckedAt: Date.now(),
        lastError: undefined
      });
      if (!updated) throw new ServiceError(404, `子号不存在: ${id}`);
      await this.store.appendLog(id, {
        phase: 'personal_settings_update',
        status: 'success',
        message: `已${enabled ? '开启' : '关闭'}记忆`,
        data: { enabled, response }
      });
      return updated;
    } catch (error) {
      await this.persistWebRequestError(id, 'personal_settings_update', '修改记忆设置失败', error, { enabled });
      throw asServiceError(error);
    }
  }

  async updatePersonalProfile(
    id: string,
    input: { username?: string; displayName?: string }
  ): Promise<SubaccountView> {
    let subaccount = this.requireSubaccount(id);
    const api = this.webApiFor(subaccount);
    let userId = subaccount.chatgptUserId?.trim();
    const responses: Record<string, unknown> = {};
    try {
      if (!userId) {
        const me = await api.getMe();
        responses.me = me;
        userId = readOptionalString(me, 'id');
        if (!userId) throw new ServiceError(502, '个人资料响应缺少 user id');
        const saved = await this.store.update(id, {
          chatgptUserId: userId,
          remoteDisplayName: readOptionalString(me, 'name'),
          remotePictureUrl: readOptionalString(me, 'picture'),
          personalProfileCachedAt: Date.now()
        });
        if (saved) subaccount = this.requireSubaccount(id);
      }

      let patch: Partial<Subaccount> = {};
      if (input.username !== undefined) {
        const response = await api.setPersonalUsername(userId, input.username);
        responses.username = response;
        patch = { ...patch, ...personalProfilePatch(response, Date.now()) };
      }
      if (input.displayName !== undefined) {
        const response = await api.setPersonalDisplayName(userId, input.displayName);
        responses.displayName = response;
        patch = { ...patch, ...personalProfilePatch(response, Date.now()) };
      }
      const updated = await this.store.update(id, {
        ...patch,
        chatgptUserId: userId,
        webAccessTokenStatus: 'valid',
        webAccessTokenCheckedAt: Date.now(),
        lastError: undefined
      });
      if (!updated) throw new ServiceError(404, `子号不存在: ${id}`);
      await this.store.appendLog(id, {
        phase: 'personal_profile_update',
        status: 'success',
        message: '已修改 ChatGPT 个人资料',
        data: { input, responses }
      });
      return updated;
    } catch (error) {
      await this.persistWebRequestError(id, 'personal_profile_update', '修改 ChatGPT 个人资料失败', error, {
        input,
        responses
      });
      throw asServiceError(error);
    }
  }

  private webApiFor(
    subaccount: Subaccount,
    onSessionRefreshed?: (session: Record<string, unknown>, accessToken: string) => Promise<void> | void
  ): ChatGptApi {
    if (!subaccount.chatgptAccountId?.trim()) throw new ServiceError(400, '子号缺少 ChatGPT account.id');
    if (!subaccount.webAccessToken?.trim()) throw new ServiceError(400, '子号缺少 ChatGPT Web accessToken');
    return new ChatGptApi(
      {
        accountId: subaccount.chatgptAccountId,
        accessToken: subaccount.webAccessToken,
        proxy: subaccount.proxy,
        refreshWebAccessToken: subaccount.sessionToken?.trim()
          ? async () => {
              const session = await fetchWorkspaceWebSessionFromSessionToken(
                this.webTransport,
                subaccount.sessionToken!,
                subaccount.chatgptAccountId!,
                subaccount.proxy
              );
              const accessToken = readSessionAccessToken(session);
              await this.store.update(subaccount.id, {
                webAccessToken: accessToken,
                sessionTokenStatus: 'valid',
                sessionTokenCheckedAt: Date.now()
              });
              await onSessionRefreshed?.(session, accessToken);
              return accessToken;
            }
          : undefined
      },
      this.webTransport
    );
  }

  private async persistWebRequestError(
    id: string,
    phase: string,
    message: string,
    error: unknown,
    data: Record<string, unknown> = {}
  ): Promise<void> {
    const checkedAt = Date.now();
    const current = this.requireSubaccount(id);
    await this.store.update(id, {
      sessionTokenStatus:
        error instanceof ChatGptWebSessionError ? 'invalid' : current.sessionTokenStatus,
      sessionTokenCheckedAt:
        error instanceof ChatGptWebSessionError ? checkedAt : current.sessionTokenCheckedAt,
      webAccessTokenStatus:
        error instanceof ChatGptApiError && error.status === 401 ? 'invalid' : current.webAccessTokenStatus,
      webAccessTokenCheckedAt: checkedAt,
      lastRefreshAt: checkedAt,
      lastError: fullErrorMessage(error)
    });
    await this.store.appendLog(id, {
      phase,
      status: 'error',
      message,
      data: { ...data, error: fullErrorEvidence(error) }
    });
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
      const webAccessToken = await this.resolveWorkspaceWebAccessToken(subaccount, target);
      const api = new ChatGptApi(
        {
          accountId: target,
          accessToken: webAccessToken,
          proxy: subaccount.proxy
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

  async createK12WorkspaceCredential(id: string, targetChatgptAccountId?: string): Promise<SubaccountView> {
    const subaccount = this.requireSubaccount(id);
    const target = cleanTargetAccountId(targetChatgptAccountId);
    if (!target) throw new ServiceError(400, '缺少 chatgptAccountId');
    if (!subaccount.sessionToken?.trim() && !subaccount.webAccessToken?.trim()) {
      throw new ServiceError(400, '子号缺少 ChatGPT Web session，无法创建 K12 凭证');
    }

    await this.store.update(id, { status: 'codex_auth_pending', lastError: undefined });
    await this.store.appendLog(id, {
      phase: 'k12_credential_create_start',
      status: 'codex_auth_pending',
      message: '已开始通过子号 workspace session 创建 K12 Codex 凭证',
      data: { targetChatgptAccountId: target }
    });

    try {
      const session = subaccount.sessionToken?.trim()
        ? await fetchWorkspaceExchangeSessionFromSessionToken(
            this.webTransport,
            subaccount.sessionToken,
            target,
            subaccount.proxy
          )
        : workspaceSessionFromAccessToken(subaccount.webAccessToken!, target, subaccount.email);
      const credential = codexCredentialFromWorkspaceSession(session, {
        fallbackEmail: subaccount.email,
        planType: 'k12'
      });
      const updated = await this.store.saveCodexCredential(id, credential);
      if (!updated) throw new ServiceError(404, `子号不存在: ${id}`);
      await this.store.appendLog(id, {
        phase: 'k12_credential_create_complete',
        status: 'codex_ready',
        message: '已通过 K12 workspace session 保存 Codex 凭证 JSON',
        data: {
          email: credential.email,
          accountId: credential.account_id,
          planType: credential.plan_type,
          authMode: credential.auth_mode
        }
      });
      return updated;
    } catch (e) {
      const message =
        e instanceof ChatGptWebSessionError
          ? `创建 K12 Codex 凭证失败: ${e.message}`
          : (e as Error).message;
      await this.store.update(id, { status: 'error', lastError: message });
      await this.store.appendLog(id, {
        phase: 'k12_credential_create_complete',
        status: 'error',
        message,
        data: { targetChatgptAccountId: target }
      });
      if (e instanceof ServiceError) throw e;
      if (e instanceof ChatGptWebSessionError) throw new ServiceError(e.status, message);
      throw e;
    }
  }

  private async resolveWorkspaceWebAccessToken(subaccount: Subaccount, target: string): Promise<string> {
    if (subaccount.sessionToken?.trim()) {
      try {
        return await fetchWorkspaceWebAccessTokenFromSessionToken(
          this.webTransport,
          subaccount.sessionToken,
          target,
          subaccount.proxy
        );
      } catch (e) {
        if (e instanceof ChatGptWebSessionError) throw new ServiceError(e.status, e.message);
        throw e;
      }
    }
    if (!subaccount.webAccessToken?.trim()) {
      throw new ServiceError(400, '子号缺少 ChatGPT Web session，无法创建个人访问令牌');
    }
    return subaccount.webAccessToken;
  }

  private async resolveSubaccountSessionInput(
    raw: unknown
  ): Promise<Awaited<ReturnType<typeof resolveChatGptSessionImportInput>>> {
    try {
      return await resolveChatGptSessionImportInput(raw, this.webTransport);
    } catch (e) {
      if (e instanceof ChatGptWebSessionError) throw new ServiceError(e.status, e.message);
      throw e;
    }
  }

  async registerNewSubaccount(input: {
    mailGroup?: string;
    email?: string;
    password?: string;
    resumeExisting?: boolean;
    onEvent?: (event: Record<string, unknown> & { phase?: string }) => void | Promise<void>;
  }): Promise<SubaccountView> {
    if (!this.registration) throw new ServiceError(501, '未配置子号自动注册 worker');
    const mailGroup = cleanOptionalString(input.mailGroup);
    const email = cleanOptionalString(input.email);
    const password = cleanOptionalString(input.password);

    try {
      const result = await this.registration.register({
        mailGroup,
        email,
        password,
        resumeExisting: input.resumeExisting === true,
        onEvent: input.onEvent
      });

      const registered = await this.store.saveRegisteredSubaccount({
        email: result.email,
        password: result.password,
        session: result.session,
        source: mailGroup ? `gongxi:${mailGroup}` : 'gongxi',
        status: 'session_ready'
      });

      await this.store.appendLog(registered.id, {
        phase: 'subaccount_registration_trace',
        status: registered.status,
        message: '子号自动注册原始完整日志',
        data: {
          email: result.email,
          password: result.password,
          name: result.name,
          birthdate: result.birthdate,
          callbackUrl: result.callbackUrl,
          session: result.session,
          mailGroup,
          events: result.events
        }
      });

      try {
        const mailbox = await this.registration.completeMailbox(result.email);
        await this.store.appendLog(registered.id, {
          phase: 'subaccount_registration_mailbox_complete',
          status: registered.status,
          message: `GongXi-Mail 邮箱已转移到分组 ${mailbox.group}`,
          data: {
            email: mailbox.email,
            group: mailbox.group,
            events: mailbox.events
          }
        });
      } catch (mailboxError) {
        const message = `子号已录入，但 GongXi-Mail 邮箱分组转移失败: ${(mailboxError as Error).message}`;
        await this.store.appendLog(registered.id, {
          phase: 'subaccount_registration_mailbox_complete',
          status: 'error',
          message,
          data: {
            email: result.email,
            error: mailboxError instanceof SubaccountRegistrationError
              ? {
                  message: mailboxError.message,
                  status: mailboxError.status,
                  challenge: mailboxError.challenge,
                  events: mailboxError.events
                }
              : { message: (mailboxError as Error).message, stack: (mailboxError as Error).stack }
          }
        });
        const updated = await this.store.update(registered.id, { lastError: message });
        return updated ?? registered;
      }

      await this.store.appendLog(registered.id, {
        phase: 'subaccount_registration_complete',
        status: registered.status,
        message: '子号自动注册、Web Session 录入和邮箱分组转移完成',
        data: {
          email: result.email,
          password: result.password,
          name: result.name,
          birthdate: result.birthdate,
          session: result.session,
          mailGroup,
          callbackUrl: result.callbackUrl
        }
      });
      return registered;
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
          phase: 'subaccount_registration_trace',
          status,
          message: e.message,
          data: {
            workerStatus: e.status,
            challenge: e.challenge,
            email: e.email,
            password: e.password,
            mailGroup,
            events: e.events
          }
        });
        return registered;
      }
      if (e instanceof SubaccountRegistrationError) {
        await this.store.appendLog(undefined, {
          phase: 'subaccount_registration_trace',
          status: 'error',
          message: e.message,
          data: {
            workerStatus: e.status,
            challenge: e.challenge,
            email: e.email,
            password: e.password,
            mailGroup,
            events: e.events
          }
        });
        throw new ServiceError(502, e.message);
      }
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

  async getWorkspaceSession(id: string, targetChatgptAccountId?: string): Promise<Record<string, unknown>> {
    const subaccount = this.requireSubaccount(id);
    const target = cleanTargetAccountId(targetChatgptAccountId);
    if (!target) throw new ServiceError(400, '缺少 chatgptAccountId');
    if (!subaccount.sessionToken?.trim()) {
      throw new ServiceError(400, '子号缺少 sessionToken，无法下载目标 workspace Session');
    }

    try {
      return await fetchWorkspaceWebSessionFromSessionToken(
        this.webTransport,
        subaccount.sessionToken,
        target,
        subaccount.proxy
      );
    } catch (e) {
      if (e instanceof ChatGptWebSessionError) throw new ServiceError(e.status, e.message);
      throw e;
    }
  }

  async refreshQuota(id: string, targetChatgptAccountId?: string): Promise<CodexQuotaSnapshot> {
    const credential = this.getCodexCredential(id, targetChatgptAccountId);
    const subaccount = this.requireSubaccount(id);
    const snapshot = await fetchCodexQuota(credential, this.quotaTransport, subaccount.proxy);
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

function parseJsonObject(body: string, message: string): Record<string, unknown> {
  try {
    const data = JSON.parse(body) as unknown;
    return data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {};
  } catch {
    throw new ServiceError(502, message);
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

function registrationProgressFromEvent(
  event: Record<string, unknown> & { phase?: string }
): { phase: string; message: string; progress: number; email?: string } | undefined {
  const phase = event.phase?.trim();
  if (!phase) return undefined;
  const email = typeof event.email === 'string' && event.email.trim() ? event.email.trim() : undefined;
  const stages: Record<string, { progress: number; message: string }> = {
    flaresolverr_session_create: { progress: 5, message: '浏览器会话已准备' },
    registration_proxy_selected: { progress: 8, message: '代理出口已确认' },
    chatgpt_auth_csrf: { progress: 12, message: '正在建立 ChatGPT 登录会话' },
    chatgpt_auth_csrf_retry: { progress: 16, message: 'Cloudflare 验证已完成' },
    chatgpt_auth_signin: { progress: 20, message: '已进入 OpenAI 注册流程' },
    registration_identity_allocated: { progress: 32, message: email ? `已取得邮箱 ${email}` : '已取得注册邮箱' },
    authorize_continue_signup: { progress: 40, message: '正在确认账号注册方式' },
    registration_retry_existing_account: { progress: 44, message: '邮箱已注册，正在用原密码恢复登录' },
    registration_passwordless_signup_password_branch: { progress: 44, message: '已切换到密码注册' },
    user_register: { progress: 50, message: '账号密码已提交' },
    user_register_from_passwordless_signup: { progress: 50, message: '账号密码已提交' },
    email_otp_send: { progress: 56, message: '正在等待邮箱验证码' },
    gongxi_mail_poll: { progress: 60, message: '正在读取 GongXi-Mail 验证码' },
    email_otp_validate_code_received: { progress: 68, message: '已收到邮箱验证码' },
    email_otp_validate: { progress: 72, message: '邮箱验证完成' },
    registration_profile_generated: { progress: 76, message: '正在填写账号资料' },
    create_account: { progress: 82, message: '账号资料已提交' },
    chatgpt_callback_1: { progress: 86, message: '正在完成 ChatGPT 回调' },
    chatgpt_callback_2: { progress: 90, message: '正在建立 Web Session' },
    chatgpt_auth_session: { progress: 94, message: 'Web Session 已取得' },
    flaresolverr_session_destroy: { progress: 96, message: '正在保存子号数据' }
  };
  const stage = stages[phase];
  if (!stage) return undefined;
  return { phase, message: stage.message, progress: stage.progress, ...(email ? { email } : {}) };
}

function cleanTargetAccountId(value?: string): string | undefined {
  const target = value?.trim();
  return target || undefined;
}

function parseSubaccountSessionImportPayload(raw: unknown): {
  session: unknown;
  remark?: string;
  proxy?: string;
  hasRemark: boolean;
  hasProxy: boolean;
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { session: raw, hasRemark: false, hasProxy: false };
  }

  const record = raw as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(record, 'session')) {
    return { session: raw, hasRemark: false, hasProxy: false };
  }

  const hasRemark = Object.prototype.hasOwnProperty.call(record, 'remark');
  const hasProxy = Object.prototype.hasOwnProperty.call(record, 'proxy');
  if (hasRemark && record.remark !== undefined && typeof record.remark !== 'string') {
    throw new ServiceError(400, '备注必须是字符串');
  }
  if (hasProxy && record.proxy !== undefined && typeof record.proxy !== 'string') {
    throw new ServiceError(400, '代理地址必须是字符串');
  }
  if (record.session === undefined) throw new ServiceError(400, '缺少 session JSON');

  return {
    session: record.session,
    ...(hasRemark ? { remark: (record.remark as string | undefined)?.trim() || undefined } : {}),
    ...(hasProxy ? { proxy: (record.proxy as string | undefined)?.trim() || undefined } : {}),
    hasRemark,
    hasProxy
  };
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

function personalProfilePatch(response: Record<string, unknown>, cachedAt: number): Partial<Subaccount> {
  return {
    chatgptUserId: readOptionalString(response, 'user_id'),
    remoteUsername: readOptionalString(response, 'username'),
    remoteDisplayName: readOptionalString(response, 'display_name'),
    remotePictureUrl: readOptionalString(response, 'profile_picture_url'),
    personalProfileCachedAt: cachedAt
  };
}

function marketingNotificationPatch(response: Record<string, unknown>, cachedAt: number): Partial<Subaccount> {
  const settings = Array.isArray(response.settings) ? response.settings : [];
  const marketing = settings.find(
    (item) => item && typeof item === 'object' && (item as Record<string, unknown>).category === 'marketing'
  ) as Record<string, unknown> | undefined;
  const options = Array.isArray(marketing?.options) ? marketing.options : [];
  const enabledFor = (channel: string): boolean | undefined => {
    const option = options.find(
      (item) => item && typeof item === 'object' && (item as Record<string, unknown>).channel === channel
    ) as Record<string, unknown> | undefined;
    return typeof option?.enabled === 'boolean' ? option.enabled : undefined;
  };
  return {
    marketingPushEnabled: enabledFor('push'),
    marketingEmailEnabled: enabledFor('email'),
    marketingNotificationsCachedAt: cachedAt
  };
}

function rateLimitResetCreditsFromResponse(
  response: Record<string, unknown>,
  cachedAt: number
): NonNullable<Subaccount['rateLimitResetCredits']> {
  return {
    credits: Array.isArray(response.credits) ? response.credits : [],
    availableCount: typeof response.available_count === 'number' ? response.available_count : 0,
    totalEarnedCount: typeof response.total_earned_count === 'number' ? response.total_earned_count : 0,
    cachedAt
  };
}

function readSessionAccessToken(session: Record<string, unknown>): string {
  const accessToken = readOptionalString(session, 'accessToken');
  if (!accessToken) throw new ServiceError(502, 'ChatGPT Web Session 响应缺少 accessToken');
  return accessToken;
}

function fullErrorEvidence(error: unknown): Record<string, unknown> {
  if (error instanceof ChatGptApiError) {
    return {
      name: error.name,
      message: error.message,
      status: error.status,
      context: error.context,
      body: error.body
    };
  }
  if (error instanceof ChatGptWebSessionError || error instanceof ServiceError) {
    return {
      name: error.name,
      message: error.message,
      status: error.status
    };
  }
  return {
    name: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : String(error)
  };
}

function fullErrorMessage(error: unknown): string {
  if (error instanceof ChatGptApiError) {
    return `${error.context} HTTP ${error.status}: ${error.body}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function asServiceError(error: unknown): ServiceError {
  if (error instanceof ServiceError) return error;
  if (error instanceof ChatGptWebSessionError) return new ServiceError(error.status, fullErrorMessage(error));
  if (error instanceof ChatGptApiError) {
    const status = error.status >= 400 && error.status < 500 ? error.status : 502;
    return new ServiceError(status, fullErrorMessage(error));
  }
  return new ServiceError(502, fullErrorMessage(error));
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

function workspaceSessionFromAccessToken(
  accessToken: string,
  targetAccountId: string,
  fallbackEmail: string
): ChatGptWorkspaceSession {
  const claims = chatGptSessionClaimsFromAccessToken(accessToken);
  if (claims.accountId !== targetAccountId) {
    throw new ServiceError(
      409,
      `当前子号 Web session 与目标 workspace 不一致：目标 ${targetAccountId}，实际 ${claims.accountId || '空'}`
    );
  }
  return {
    accessToken,
    accountId: targetAccountId,
    email: claims.email || fallbackEmail,
    userId: claims.userId,
    planType: claims.planType,
    expiresAt: claims.expiresAt
  };
}

function codexCredentialFromWorkspaceSession(
  session: ChatGptWorkspaceSession,
  options: { fallbackEmail: string; planType: string },
  now: Date = new Date()
): CodexCredentialJson {
  const expiresAt = session.expiresAt ?? Math.trunc(now.getTime() / 1000) + 10 * 24 * 60 * 60;
  const expired = epochSecondsToIso(expiresAt);
  if (!expired) throw new ServiceError(502, '目标 workspace session 缺少有效过期时间');
  const planType = session.planType?.trim() || options.planType;
  return {
    id_token:
      session.idToken ||
      syntheticChatGptIdToken({
        accountId: session.accountId,
        userId: session.userId,
        email: session.email || options.fallbackEmail,
        planType,
        expiresAt
      }),
    access_token: session.accessToken,
    ...(session.refreshToken ? { refresh_token: session.refreshToken } : {}),
    account_id: session.accountId,
    last_refresh: now.toISOString(),
    email: session.email || options.fallbackEmail,
    type: 'codex',
    expired,
    plan_type: planType,
    auth_mode: 'chatgpt',
    credential_source: 'oauth',
    chatgpt_user_id: session.userId
  };
}

function syntheticChatGptIdToken(input: {
  accountId: string;
  userId?: string;
  email: string;
  planType: string;
  expiresAt: number;
}): string {
  const issuedAt = Math.trunc(Date.now() / 1000);
  const auth: Record<string, unknown> = {
    account_id: input.accountId,
    chatgpt_account_id: input.accountId,
    chatgpt_plan_type: input.planType
  };
  if (input.userId) {
    auth.chatgpt_user_id = input.userId;
    auth.user_id = input.userId;
  }
  return [
    base64UrlJson({ alg: 'none', typ: 'JWT', cpa_synthetic: true }),
    base64UrlJson({
      iat: issuedAt,
      exp: input.expiresAt,
      email: input.email,
      'https://api.openai.com/auth': auth
    }),
    'synthetic'
  ].join('.');
}

function chatGptSessionClaimsFromAccessToken(accessToken: string): {
  accountId?: string;
  userId?: string;
  email?: string;
  planType?: string;
  expiresAt?: number;
} {
  const payloadPart = accessToken.split('.')[1];
  if (!payloadPart) return {};
  try {
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as Record<string, unknown>;
    const auth = payload['https://api.openai.com/auth'];
    const record = auth && typeof auth === 'object' ? (auth as Record<string, unknown>) : {};
    return {
      accountId: readOptionalString(record, 'chatgpt_account_id') ?? readOptionalString(record, 'account_id'),
      userId: readOptionalString(record, 'chatgpt_user_id') ?? readOptionalString(record, 'user_id'),
      email: readOptionalString(payload, 'email'),
      planType: readOptionalString(record, 'chatgpt_plan_type') ?? readOptionalString(record, 'plan_type'),
      expiresAt: typeof payload.exp === 'number' && Number.isFinite(payload.exp) ? Math.trunc(payload.exp) : undefined
    };
  } catch {
    return {};
  }
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
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
  const target = targetAccountId?.trim();
  if (target && issuedAccountId !== target) {
    throw new ServiceError(
      409,
      `个人访问令牌 workspace 与目标不一致：目标 ${target}，实际 ${issuedAccountId}`
    );
  }
  const accountId = issuedAccountId;
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
    chatgpt_user_id: response.owner_user_id
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
