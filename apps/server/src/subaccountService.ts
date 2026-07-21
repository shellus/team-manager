import type {
  CodexCredentialJson,
  CodexQuotaSnapshot,
  Subaccount,
  SubaccountAuthLog,
  SubaccountLocalProfileView,
  SubaccountRegistrationJobView,
  AccountManagerRuntimeStatus,
  SubaccountSummaryView,
  SubaccountView
} from '@team-manager/shared';
import { fetchCodexQuota } from './codexQuota.js';
import { ServiceError } from './teamService.js';
import {
  ChatGptApi,
  ChatGptApiError,
  type CodexPersonalAccessTokenResponse
} from './chatgptApi.js';
import {
  ChatGptWebSessionError,
  fetchWorkspaceWebAccessTokenFromSessionToken,
  fetchWorkspaceWebSessionFromSessionToken,
  resolveChatGptSessionImportInput,
} from './chatgptWebSession.js';
import { createTransport, type Transport } from './transport.js';
import { SubaccountStore } from './subaccountStore.js';
import {
  ACCOUNT_MANAGER_REQUEST_TAGS,
  AccountManagerError,
  type AccountManagerGateway
} from './accountManagerClient.js';

const CODEX_PAT_NAME = 'team-manager';
const CODEX_PAT_TTL_SECONDS = 30 * 24 * 60 * 60;
const CODEX_LOCAL_ACCESS_SCOPE = 'chatgpt.workspace.feature.allow-codex-local-access.access';

export class SubaccountService {
  constructor(
    private readonly store: SubaccountStore,
    private readonly quotaTransport: Transport = createTransport(),
    private readonly webTransport: Transport = createTransport(),
    private readonly accountManager?: AccountManagerGateway
  ) {}

  list(): SubaccountView[] {
    return this.store.list();
  }

  listSummaries(): SubaccountSummaryView[] {
    return this.store.listSummaries();
  }

  detail(id: string): SubaccountView {
    const subaccount = this.store.detail(id);
    if (!subaccount) throw new ServiceError(404, `子号不存在: ${id}`);
    return subaccount;
  }

  localProfile(id: string): SubaccountLocalProfileView {
    const profile = this.store.localProfile(id);
    if (!profile) throw new ServiceError(404, `子号不存在: ${id}`);
    return profile;
  }

  async listRegistrationJobs(): Promise<SubaccountRegistrationJobView[]> {
    if (!this.accountManager) return [];
    return this.reconcileAccountManagerOperations(
      await this.callAccountManager(() => this.accountManager!.listRegistrations(ACCOUNT_MANAGER_REQUEST_TAGS.subaccount))
    );
  }

  async startSubaccountRegistration(input: {
    mailGroup?: string;
    email?: string;
    password?: string;
    resumeExisting?: boolean;
  }): Promise<SubaccountRegistrationJobView> {
    if (!this.accountManager) throw new ServiceError(503, '未配置 GPT Account Manager');
    return this.callAccountManager(() => this.accountManager!.startRegistration({
      ...input,
      requestTag: ACCOUNT_MANAGER_REQUEST_TAGS.subaccount
    }));
  }

  async retrySubaccountRegistration(jobId: string): Promise<SubaccountRegistrationJobView> {
    if (!this.accountManager) throw new ServiceError(503, '未配置 GPT Account Manager');
    await this.requireSubaccountRegistration(jobId);
    return this.callAccountManager(() => this.accountManager!.retryRegistration(jobId));
  }

  async removeSubaccountRegistrationJob(jobId: string): Promise<boolean> {
    if (!this.accountManager) throw new ServiceError(503, '未配置 GPT Account Manager');
    await this.requireSubaccountRegistration(jobId);
    return this.callAccountManager(() => this.accountManager!.removeOperation(jobId));
  }

  private async requireSubaccountRegistration(jobId: string): Promise<void> {
    const operation = await this.callAccountManager(() => this.accountManager!.operation(jobId));
    if (
      operation.type !== 'register' ||
      operation.requestSummary?.requestTag !== ACCOUNT_MANAGER_REQUEST_TAGS.subaccount
    ) {
      throw new ServiceError(404, `子号注册操作不存在: ${jobId}`);
    }
  }

  private async reconcileAccountManagerOperations(
    jobs: SubaccountRegistrationJobView[]
  ): Promise<SubaccountRegistrationJobView[]> {
    if (!this.accountManager) return jobs;
    const reconciled: SubaccountRegistrationJobView[] = [];
    for (const job of jobs) {
      if (job.status !== 'succeeded' || !job.email) {
        reconciled.push(job);
        continue;
      }
      const existing = this.store.getByEmail(job.email);
      if (existing?.managedAccountEmail === job.email.toLowerCase()) {
        reconciled.push({ ...job, subaccountId: existing.id });
        continue;
      }
      const session = await this.callAccountManager(() => this.accountManager!.session(job.email!));
      const registered = await this.store.saveManagedSubaccount({
        managedAccountEmail: job.email,
        email: job.email,
        session,
        status: 'session_ready'
      });
      await this.store.appendLog(registered.id, {
        phase: 'account_manager_session_import',
        status: registered.status,
        message: '已从 GPT Account Manager 取得 Web Session 并关联账号引用',
        data: { managedAccountEmail: registered.managedAccountEmail, operationId: job.id }
      });
      try {
        await this.callAccountManager(() => this.accountManager!.removeOperation(job.id));
      } catch (error) {
        await this.store.appendLog(registered.id, {
          phase: 'account_manager_operation_cleanup',
          status: 'error',
          message: `账号已导入，但 Account Manager 操作清理失败: ${(error as Error).message}`,
          data: { operationId: job.id }
        });
      }
      reconciled.push({ ...job, subaccountId: registered.id });
    }
    return reconciled;
  }

  private async callAccountManager<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof AccountManagerError) throw new ServiceError(error.status, error.message);
      throw error;
    }
  }

  async getRegistrationRuntimeStatus(): Promise<AccountManagerRuntimeStatus> {
    if (!this.accountManager) {
      return { configured: false, reachable: false, error: '未配置 GPT Account Manager' };
    }
    try {
      const health = await this.accountManager.health();
      return {
        configured: health.accountRegistrationConfigured === true,
        reachable: health.status === 'ok',
        ...(health.accountRegistrationConfigured === true ? {} : { error: 'GPT Account Manager 注册环境未配置完整' })
      };
    } catch (error) {
      return {
        configured: true,
        reachable: false,
        error: error instanceof AccountManagerError ? error.message : (error as Error).message
      };
    }
  }

  async importSession(raw: unknown): Promise<SubaccountView> {
    const payload = parseSubaccountSessionImportPayload(raw);
    const input = await this.resolveSubaccountSessionInput(payload.session);
    const view = await this.store.importSession(input.session, {
      ...(payload.hasRemark ? { remark: payload.remark } : {}),
      ...(payload.hasGroupName ? { groupName: payload.groupName } : {}),
      ...(payload.hasProxy ? { proxy: payload.proxy } : {})
    });
    await this.store.appendLog(view.id, {
      phase: 'session_import',
      status: 'session_ready',
      message: '已录入子号 ChatGPT session JSON',
      data: {
        email: view.email,
        accountIdPresent: Boolean(view.chatgptAccountId),
        localProfilePresent: payload.hasRemark || payload.hasGroupName || payload.hasProxy,
        groupName: view.groupName,
        proxyPresent: Boolean(view.proxy),
        inputType: input.type
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

  async updateLocalProfile(
    id: string,
    input: { remark?: unknown; groupName?: unknown; proxy?: unknown; session?: unknown }
  ): Promise<SubaccountView> {
    this.requireSubaccount(id);
    const hasRemark = Object.prototype.hasOwnProperty.call(input, 'remark');
    const hasGroupName = Object.prototype.hasOwnProperty.call(input, 'groupName');
    const hasProxy = Object.prototype.hasOwnProperty.call(input, 'proxy');
    if (hasRemark && input.remark !== undefined && typeof input.remark !== 'string') {
      throw new ServiceError(400, '备注必须是字符串');
    }
    if (hasProxy && input.proxy !== undefined && typeof input.proxy !== 'string') {
      throw new ServiceError(400, '代理地址必须是字符串');
    }
    if (hasGroupName && input.groupName !== undefined && typeof input.groupName !== 'string') {
      throw new ServiceError(400, '子号分组必须是字符串');
    }
    const remark = typeof input.remark === 'string' ? input.remark.trim() || undefined : undefined;
    const groupName = typeof input.groupName === 'string' ? input.groupName.trim() || '默认分组' : undefined;
    const proxy = typeof input.proxy === 'string' ? input.proxy.trim() || undefined : undefined;

    const sessionInput =
      input.session === undefined
        ? undefined
        : await this.resolveSubaccountSessionInput(input.session);

    const updated = await this.store.updateLocalProfile(id, {
      ...(hasRemark ? { remark } : {}),
      ...(hasGroupName ? { groupName } : {}),
      ...(hasProxy ? { proxy } : {}),
      session: sessionInput?.session
    });
    if (!updated) throw new ServiceError(404, `子号不存在: ${id}`);

    await this.store.appendLog(id, {
      phase: 'local_profile_update',
      status: updated.status,
      message: input.session === undefined ? '已更新子号本地资料' : '已更新子号本地资料和 ChatGPT session',
      data: {
        email: updated.email,
        groupName: updated.groupName,
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
          if (!isOptionalPersonalProfileUnavailable(error)) {
            errors.push(`用户名资料读取失败: ${fullErrorMessage(error)}`);
          }
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
    if ((patch.sessionTokenStatus ?? initial.sessionTokenStatus) === 'valid' && initial.status === 'error') {
      patch.status = initial.codexCredentials?.length ? 'codex_ready' : 'session_ready';
    }
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

    await this.store.update(id, { status: 'pat_creating', lastError: undefined });
    await this.store.appendLog(id, {
      phase: 'codex_pat_create_start',
      status: 'pat_creating',
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

function cleanTargetAccountId(value?: string): string | undefined {
  const target = value?.trim();
  return target || undefined;
}

function parseSubaccountSessionImportPayload(raw: unknown): {
  session: unknown;
  remark?: string;
  groupName?: string;
  proxy?: string;
  hasRemark: boolean;
  hasGroupName: boolean;
  hasProxy: boolean;
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { session: raw, hasRemark: false, hasGroupName: false, hasProxy: false };
  }

  const record = raw as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(record, 'session')) {
    return { session: raw, hasRemark: false, hasGroupName: false, hasProxy: false };
  }

  const hasRemark = Object.prototype.hasOwnProperty.call(record, 'remark');
  const hasGroupName = Object.prototype.hasOwnProperty.call(record, 'groupName');
  const hasProxy = Object.prototype.hasOwnProperty.call(record, 'proxy');
  if (hasRemark && record.remark !== undefined && typeof record.remark !== 'string') {
    throw new ServiceError(400, '备注必须是字符串');
  }
  if (hasProxy && record.proxy !== undefined && typeof record.proxy !== 'string') {
    throw new ServiceError(400, '代理地址必须是字符串');
  }
  if (hasGroupName && record.groupName !== undefined && typeof record.groupName !== 'string') {
    throw new ServiceError(400, '子号分组必须是字符串');
  }
  if (record.session === undefined) throw new ServiceError(400, '缺少 session JSON');

  return {
    session: record.session,
    ...(hasRemark ? { remark: (record.remark as string | undefined)?.trim() || undefined } : {}),
    ...(hasGroupName ? { groupName: (record.groupName as string | undefined)?.trim() || '默认分组' } : {}),
    ...(hasProxy ? { proxy: (record.proxy as string | undefined)?.trim() || undefined } : {}),
    hasRemark,
    hasGroupName,
    hasProxy
  };
}

function cleanOptionalString(value?: string): string | undefined {
  const cleaned = value?.trim();
  return cleaned || undefined;
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

function isOptionalPersonalProfileUnavailable(error: unknown): boolean {
  if (!(error instanceof ChatGptApiError) || error.status !== 401) return false;
  try {
    const payload = JSON.parse(error.body) as { error?: { code?: unknown; message?: unknown } };
    return payload.error?.code === 'no_organization'
      || (typeof payload.error?.message === 'string'
        && /must be a member of an organization/i.test(payload.error.message));
  } catch {
    return /no_organization|must be a member of an organization/i.test(error.body);
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
