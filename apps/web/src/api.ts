import type {
  AccountBillingSnapshot,
  AccountManagerOperationView,
  AccountManagerProfileView,
  AccountManagerRuntimeStatus,
  AccountLimitType,
  AccountLocalProfileView,
  AccountOverviewView,
  AccountSeatSlotProfileInput,
  AccountSummaryView,
  AccountView,
  EditableMemberRole,
  Member,
  NotificationSettings,
  OpenCodexSpaceRequest,
  OpenTeamSubscriptionRequest,
  OpenPro5xRequest,
  ParentAccountManagerStatus,
  ParentRegistrationTaskView,
  Pro5xPaymentStatisticsView,
  Pro5xRenewalCancellationResult,
  Pro5xSubscriptionView,
  ResidentialProxyConfig,
  RrwebRecordingUploadView,
  PublicSeatSlotView,
  PendingInvite,
  SeatType,
  ApiResult,
  SubaccountAuthLog,
  SubaccountAccountManagerStatus,
  SubaccountLocalProfileView,
  SubaccountRegistrationJobView,
  SubaccountSummaryView,
  SubaccountView,
  CodexAuthStart,
  CodexCredentialJson,
  CodexQuotaSnapshot,
  MaintainedTeamOrder,
  TeamOrderBatchResult,
  TeamOrderConfig,
  TeamOrderConfigOverrides,
  TeamOrderDashboardView,
  TeamOrderMaintenanceView,
  TaskFormPreferences
} from '@team-manager/shared';

const TOKEN_KEY = 'teammgr_token';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly path: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (res.status === 401 && path !== '/auth/login') {
    clearToken();
    throw new ApiError(401, '登录已失效，请重新登录', path);
  }
  const json = (await res.json().catch(() => ({}))) as ApiResult<T>;
  if (!json.ok) throw new ApiError(res.status, json.error ?? `请求失败 ${res.status}`, path);
  return json.data as T;
}

async function publicCall<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`/public${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const json = (await res.json().catch(() => ({}))) as ApiResult<T>;
  if (!json.ok) throw new ApiError(res.status, json.error ?? `请求失败 ${res.status}`, `/public${path}`);
  return json.data as T;
}

export const apiClient = {
  getPublicSeatSlot: (seatKey: string) =>
    publicCall<PublicSeatSlotView>('GET', `/seat-slots/${encodeURIComponent(seatKey)}`),
  swapPublicSeatSlotEmail: (seatKey: string, email: string) =>
    publicCall<PublicSeatSlotView>('POST', `/seat-slots/${encodeURIComponent(seatKey)}/swap`, { email }),
  login: (username: string, password: string) =>
    call<{ token: string }>('POST', '/auth/login', { username, password }),
  uploadRrwebRecording: (recording: unknown) =>
    call<RrwebRecordingUploadView>('POST', '/devtools/rrweb-recordings', recording),
  getRrwebRecording: (uuid: string) =>
    call<unknown>('GET', `/devtools/rrweb-recordings/${encodeURIComponent(uuid)}`),
  listAccounts: () => call<AccountSummaryView[]>('GET', '/accounts'),
  listAccountOverview: () => call<AccountOverviewView[]>('GET', '/accounts/overview'),
  getAccount: (id: string) => call<AccountView>('GET', `/accounts/${id}`),
  getAccountLocalProfile: (id: string) =>
    call<AccountLocalProfileView>('GET', `/accounts/${id}/local-profile`),
  getParentRegistrationRuntimeStatus: () =>
    call<AccountManagerRuntimeStatus>('GET', '/accounts/registration/status'),
  listParentRegistrationTasks: () =>
    call<ParentRegistrationTaskView[]>('GET', '/accounts/registration/tasks'),
  registerParentAccount: (payload: { country: string; groupName: string }) =>
    call<AccountManagerOperationView>('POST', '/accounts/registration/start', payload),
  retryParentRegistration: (operationId: string) =>
    call<AccountManagerOperationView>('POST', `/accounts/registration/tasks/${operationId}/retry`),
  cancelParentRegistration: (operationId: string) =>
    call<ParentRegistrationTaskView>('POST', `/accounts/registration/tasks/${operationId}/cancel`),
  rotateParentRegistrationIp: (operationId: string) =>
    call<ParentRegistrationTaskView>('POST', `/accounts/registration/tasks/${operationId}/rotate-ip`),
  getParentRegistrationProxy: (operationId: string) =>
    call<ResidentialProxyConfig>('GET', `/accounts/registration/tasks/${operationId}/proxy`),
  updateParentRegistrationProxy: (operationId: string, payload: ResidentialProxyConfig) =>
    call<ResidentialProxyConfig>('PUT', `/accounts/registration/tasks/${operationId}/proxy`, payload),
  getParentAccountManagerStatus: (id: string) =>
    call<ParentAccountManagerStatus>('GET', `/accounts/${id}/account-manager/status`),
  getParentAccountManagerStatuses: () =>
    call<Record<string, ParentAccountManagerStatus>>('GET', '/accounts/account-manager/statuses'),
  getPro5xPaymentStatistics: () =>
    call<Pro5xPaymentStatisticsView>('GET', '/account-manager/pro5x/payment-statistics'),
  manageParentAccount: (id: string) =>
    call<ParentAccountManagerStatus>('POST', `/accounts/${id}/account-manager/manage`),
  getParentAccountProfile: (id: string) =>
    call<AccountManagerProfileView>('GET', `/accounts/${id}/account-manager/profile`),
  getParentAccountProfiles: () =>
    call<Record<string, AccountManagerProfileView>>('GET', '/accounts/account-manager/profiles'),
  startParentAccountProfile: (id: string) =>
    call<AccountManagerProfileView>('POST', `/accounts/${id}/account-manager/profile/start`),
  stopParentAccountProfile: (id: string) =>
    call<AccountManagerProfileView>('POST', `/accounts/${id}/account-manager/profile/stop`),
  getParentAccountProxy: (id: string) =>
    call<ResidentialProxyConfig>('GET', `/accounts/${id}/account-manager/proxy`),
  updateParentAccountProxy: (id: string, payload: ResidentialProxyConfig) =>
    call<ResidentialProxyConfig>('PUT', `/accounts/${id}/account-manager/proxy`, payload),
  openParentCodexSpace: (id: string, payload: OpenCodexSpaceRequest) =>
    call<AccountManagerOperationView>('POST', `/accounts/${id}/account-manager/open-codex-space`, payload),
  openParentTeamSubscription: (id: string, payload: OpenTeamSubscriptionRequest) =>
    call<AccountManagerOperationView>(
      'POST',
      `/accounts/${id}/account-manager/open-team-subscription`,
      payload
    ),
  openParentPro5x: (id: string, payload: OpenPro5xRequest) =>
    call<AccountManagerOperationView>(
      'POST',
      `/accounts/${id}/account-manager/open-pro-5x`,
      payload
    ),
  rotateParentOperationIp: (id: string, operationId: string) =>
    call<AccountManagerOperationView>(
      'POST',
      `/accounts/${id}/account-manager/operations/${operationId}/rotate-ip`
    ),
  retryParentOperationCurrentStep: (id: string, operationId: string) =>
    call<AccountManagerOperationView>(
      'POST',
      `/accounts/${id}/account-manager/operations/${operationId}/retry`
    ),
  terminateParentOperation: (id: string, operationId: string) =>
    call<AccountManagerOperationView>(
      'POST',
      `/accounts/${id}/account-manager/operations/${operationId}/terminate`
    ),
  provideParentPro5xPaymentCard: (id: string, operationId: string, payload: OpenPro5xRequest) =>
    call<AccountManagerOperationView>(
      'POST',
      `/accounts/${id}/account-manager/operations/${operationId}/payment-card`,
      payload
    ),
  dismissParentOperation: (id: string, operationId: string) =>
    call<boolean>('DELETE', `/accounts/${id}/account-manager/operations/${operationId}`),
  refreshAccount: (id: string) => call<AccountView>('POST', `/accounts/${id}/refresh`),
  renameTeam: (id: string, name: string) => call<AccountView>('PATCH', `/accounts/${id}/name`, { name }),
  updateAccountLocalProfile: (
    id: string,
    payload: {
      remark?: string;
      groupName?: string;
      limitType?: AccountLimitType;
      isBanned?: boolean;
      nextRenewalOn?: string;
      proxy?: string;
      session?: unknown;
    }
  ) =>
    call<AccountView>('PATCH', `/accounts/${id}/local-profile`, payload),
  addAccount: (payload: Record<string, unknown>) => call<AccountView>('POST', '/accounts', payload),
  removeAccount: (id: string) => call<boolean>('DELETE', `/accounts/${id}`),
  listMembers: (id: string) => call<Member[]>('GET', `/accounts/${id}/members`),
  refreshMembers: (id: string) => call<AccountView>('POST', `/accounts/${id}/members/refresh`),
  invite: (
    id: string,
    email: string,
    seat: SeatType,
    seatSlotProfile: AccountSeatSlotProfileInput | undefined
  ) =>
    call<AccountView>('POST', `/accounts/${id}/invites`, { email, seat, seatSlotProfile }),
  listPendingInvites: (id: string) => call<PendingInvite[]>('GET', `/accounts/${id}/invites`),
  refreshPendingInvites: (id: string) => call<AccountView>('POST', `/accounts/${id}/invites/refresh`),
  revokePendingInvite: (id: string, email: string) =>
    call<AccountView>('DELETE', `/accounts/${id}/invites`, { email }),
  updateSeatSlotProfile: (
    id: string,
    payload: { email: string } & AccountSeatSlotProfileInput
  ) => call<AccountView>('PATCH', `/accounts/${id}/seat-slots/profile`, payload),
  removeMember: (id: string, userId: string) => call<AccountView>('DELETE', `/accounts/${id}/members/${userId}`),
  setMemberSeat: (id: string, userId: string, seat: SeatType) =>
    call<AccountView>('PATCH', `/accounts/${id}/members/${userId}`, { seat }),
  setMemberRole: (
    id: string,
    userId: string,
    role: EditableMemberRole
  ) =>
    call<AccountView>('PATCH', `/accounts/${id}/members/${userId}/role`, {
      role
    }),
  getSettings: (id: string) => call<Record<string, unknown>>('GET', `/accounts/${id}/settings`),
  refreshSettings: (id: string) => call<AccountView>('POST', `/accounts/${id}/settings/refresh`),
  getBillingSnapshot: (id: string) => call<AccountBillingSnapshot | null>('GET', `/accounts/${id}/billing`),
  refreshBillingSnapshot: (id: string) =>
    call<AccountBillingSnapshot>('POST', `/accounts/${id}/billing/refresh`),
  setDefaultSeat: (id: string, defaultSeat: SeatType) =>
    call<AccountView>('PATCH', `/accounts/${id}/settings`, { defaultSeat }),
  setWorkspaceReferralsEnabled: (id: string, workspaceReferralsEnabled: boolean) =>
    call<AccountView>('PATCH', `/accounts/${id}/settings`, { workspaceReferralsEnabled }),
  setPersonalAccessTokensEnabled: (id: string, personalAccessTokensEnabled: boolean) =>
    call<AccountView>('PATCH', `/accounts/${id}/settings`, { personalAccessTokensEnabled }),
  setCodexDeviceCodeAuthEnabled: (id: string, codexDeviceCodeAuthEnabled: boolean) =>
    call<AccountView>('PATCH', `/accounts/${id}/settings`, { codexDeviceCodeAuthEnabled }),
  setCodexRemoteControlEnabled: (id: string, codexRemoteControlEnabled: boolean) =>
    call<AccountView>('PATCH', `/accounts/${id}/settings`, { codexRemoteControlEnabled }),
  setAutomaticReloadEnabled: (id: string, automaticReloadEnabled: boolean) =>
    call<AccountView>('PATCH', `/accounts/${id}/settings`, { automaticReloadEnabled }),
  getNotificationSettings: () => call<NotificationSettings>('GET', '/settings/notifications'),
  updateNotificationSettings: (payload: NotificationSettings) =>
    call<NotificationSettings>('PATCH', '/settings/notifications', payload),
  getTaskFormPreferences: () =>
    call<TaskFormPreferences>('GET', '/settings/task-forms'),
  updateTaskFormPreferences: (payload: Partial<TaskFormPreferences>) =>
    call<TaskFormPreferences>('PATCH', '/settings/task-forms', payload),
  getTeamOrderDashboard: () => call<TeamOrderDashboardView>('GET', '/team-orders'),
  updateTeamOrderGlobalConfig: (payload: TeamOrderConfig) =>
    call<TeamOrderConfig>('PATCH', '/team-orders/settings', payload),
  generateAllTeamOrders: () => call<TeamOrderBatchResult>('POST', '/team-orders/generate-all'),
  getAccountTeamOrderMaintenance: (id: string) =>
    call<TeamOrderMaintenanceView | null>('GET', `/accounts/${id}/team-order-maintenance`),
  saveAccountTeamOrderMaintenance: (id: string, payload: TeamOrderConfigOverrides) =>
    call<TeamOrderMaintenanceView>('POST', `/accounts/${id}/team-order-maintenance`, payload),
  setAccountTeamOrderPaused: (id: string, paused: boolean) =>
    call<TeamOrderMaintenanceView>('PATCH', `/accounts/${id}/team-order-maintenance`, { paused }),
  removeAccountTeamOrderMaintenance: (id: string) =>
    call<boolean>('DELETE', `/accounts/${id}/team-order-maintenance`),
  generateAccountTeamOrder: (id: string) =>
    call<MaintainedTeamOrder>('POST', `/accounts/${id}/team-orders`),
  retryAccountTeamOrder: (id: string, orderId: string) =>
    call<MaintainedTeamOrder>('POST', `/accounts/${id}/team-orders/${encodeURIComponent(orderId)}/retry`),
  listSubaccounts: () => call<SubaccountSummaryView[]>('GET', '/subaccounts'),
  getSubaccount: (id: string) => call<SubaccountView>('GET', `/subaccounts/${id}`),
  getSubaccountPro5xSubscription: (id: string) =>
    call<Pro5xSubscriptionView | null>('GET', `/subaccounts/${id}/pro5x-subscription`),
  cancelSubaccountPro5xRenewal: (id: string) =>
    call<Pro5xRenewalCancellationResult>(
      'POST',
      `/subaccounts/${id}/pro5x-subscription/cancel-renewal`
    ),
  getSubaccountAccountProfile: (id: string) =>
    call<AccountManagerProfileView>('GET', `/subaccounts/${id}/account-manager/profile`),
  getSubaccountAccountManagerStatus: (id: string) =>
    call<SubaccountAccountManagerStatus>('GET', `/subaccounts/${id}/account-manager/status`),
  getSubaccountAccountManagerStatuses: () =>
    call<Record<string, SubaccountAccountManagerStatus>>('GET', '/subaccounts/account-manager/statuses'),
  manageSubaccountAccount: (id: string) =>
    call<SubaccountAccountManagerStatus>('POST', `/subaccounts/${id}/account-manager/manage`),
  getSubaccountAccountProfiles: () =>
    call<Record<string, AccountManagerProfileView>>('GET', '/subaccounts/account-manager/profiles'),
  startSubaccountAccountProfile: (id: string) =>
    call<AccountManagerProfileView>('POST', `/subaccounts/${id}/account-manager/profile/start`),
  stopSubaccountAccountProfile: (id: string) =>
    call<AccountManagerProfileView>('POST', `/subaccounts/${id}/account-manager/profile/stop`),
  getSubaccountAccountProxy: (id: string) =>
    call<ResidentialProxyConfig>('GET', `/subaccounts/${id}/account-manager/proxy`),
  updateSubaccountAccountProxy: (id: string, payload: ResidentialProxyConfig) =>
    call<ResidentialProxyConfig>('PUT', `/subaccounts/${id}/account-manager/proxy`, payload),
  openSubaccountPro5x: (id: string, payload: OpenPro5xRequest) =>
    call<AccountManagerOperationView>(
      'POST',
      `/subaccounts/${id}/account-manager/open-pro-5x`,
      payload
    ),
  rotateSubaccountOperationIp: (id: string, operationId: string) =>
    call<AccountManagerOperationView>(
      'POST',
      `/subaccounts/${id}/account-manager/operations/${operationId}/rotate-ip`
    ),
  retrySubaccountOperationCurrentStep: (id: string, operationId: string) =>
    call<AccountManagerOperationView>(
      'POST',
      `/subaccounts/${id}/account-manager/operations/${operationId}/retry`
    ),
  terminateSubaccountOperation: (id: string, operationId: string) =>
    call<AccountManagerOperationView>(
      'POST',
      `/subaccounts/${id}/account-manager/operations/${operationId}/terminate`
    ),
  provideSubaccountPro5xPaymentCard: (id: string, operationId: string, payload: OpenPro5xRequest) =>
    call<AccountManagerOperationView>(
      'POST',
      `/subaccounts/${id}/account-manager/operations/${operationId}/payment-card`,
      payload
    ),
  dismissSubaccountOperation: (id: string, operationId: string) =>
    call<boolean>('DELETE', `/subaccounts/${id}/account-manager/operations/${operationId}`),
  getSubaccountLocalProfile: (id: string) =>
    call<SubaccountLocalProfileView>('GET', `/subaccounts/${id}/local-profile`),
  importSubaccountSession: (payload: {
    session: unknown;
    remark?: string;
    groupName?: string;
    isBanned?: boolean;
    proxy?: string;
  } | unknown) =>
    call<SubaccountView>('POST', '/subaccounts/session', payload),
  listSubaccountRegistrationJobs: () =>
    call<SubaccountRegistrationJobView[]>('GET', '/subaccounts/registration/jobs'),
  retrySubaccountRegistration: (jobId: string) =>
    call<SubaccountRegistrationJobView>('POST', `/subaccounts/registration/jobs/${jobId}/retry`),
  cancelSubaccountRegistration: (jobId: string) =>
    call<SubaccountRegistrationJobView>('POST', `/subaccounts/registration/jobs/${jobId}/cancel`),
  rotateSubaccountRegistrationIp: (jobId: string) =>
    call<SubaccountRegistrationJobView>('POST', `/subaccounts/registration/jobs/${jobId}/rotate-ip`),
  getSubaccountRegistrationProxy: (jobId: string) =>
    call<ResidentialProxyConfig>('GET', `/subaccounts/registration/jobs/${jobId}/proxy`),
  updateSubaccountRegistrationProxy: (jobId: string, payload: ResidentialProxyConfig) =>
    call<ResidentialProxyConfig>('PUT', `/subaccounts/registration/jobs/${jobId}/proxy`, payload),
  registerSubaccount: (payload: { mailGroup?: string; country: string; groupName: string }) =>
    call<SubaccountRegistrationJobView>('POST', '/subaccounts/registration/start', payload),
  updateSubaccountLocalProfile: (
    id: string,
    payload: { remark?: string; groupName?: string; isBanned?: boolean; proxy?: string; session?: unknown }
  ) =>
    call<SubaccountView>('PATCH', `/subaccounts/${id}/local-profile`, payload),
  refreshSubaccount: (id: string) => call<SubaccountView>('POST', `/subaccounts/${id}/refresh`),
  setSubaccountMarketingNotifications: (id: string, payload: {
    marketingPushEnabled?: boolean;
    marketingEmailEnabled?: boolean;
  }) => call<SubaccountView>('PATCH', `/subaccounts/${id}/personal-settings`, payload),
  setSubaccountMemoryEnabled: (id: string, memoryEnabled: boolean) =>
    call<SubaccountView>('PATCH', `/subaccounts/${id}/personal-settings`, { memoryEnabled }),
  updateSubaccountPersonalProfile: (id: string, payload: { username?: string; displayName?: string }) =>
    call<SubaccountView>('PATCH', `/subaccounts/${id}/personal-settings`, payload),
  removeSubaccount: (id: string) => call<boolean>('DELETE', `/subaccounts/${id}`),
  getSubaccountRegistrationRuntimeStatus: () =>
    call<AccountManagerRuntimeStatus>('GET', '/subaccounts/registration/status'),
  createSubaccountPersonalAccessTokenCredential: (id: string, chatgptAccountId?: string) =>
    call<SubaccountView>('POST', `/subaccounts/${id}/pat-credentials`, { chatgptAccountId }),
  startSubaccountCodexAuth: (id: string, chatgptAccountId: string) =>
    call<CodexAuthStart>('POST', `/subaccounts/${id}/codex-auth/start`, { chatgptAccountId }),
  completeSubaccountCodexAuth: (id: string, sessionId: string, callbackUrl: string) =>
    call<SubaccountView>('POST', `/subaccounts/${id}/codex-auth/callback`, { sessionId, callbackUrl }),
  getSubaccountCodexCredential: (id: string, chatgptAccountId?: string) => {
    const suffix = chatgptAccountId ? `?chatgptAccountId=${encodeURIComponent(chatgptAccountId)}` : '';
    return call<CodexCredentialJson>('GET', `/subaccounts/${id}/codex-credentials${suffix}`);
  },
  removeSubaccountCodexCredential: (id: string, chatgptAccountId: string) =>
    call<SubaccountView>(
      'DELETE',
      `/subaccounts/${id}/codex-credentials?chatgptAccountId=${encodeURIComponent(chatgptAccountId)}`
    ),
  refreshSubaccountQuota: (id: string, chatgptAccountId?: string) =>
    call<CodexQuotaSnapshot>('POST', `/subaccounts/${id}/quota/refresh`, { chatgptAccountId }),
  listSubaccountLogs: (id: string) => call<SubaccountAuthLog[]>('GET', `/subaccounts/${id}/logs`),
  listAllSubaccountLogs: () => call<SubaccountAuthLog[]>('GET', '/subaccounts/logs'),
  inviteSubaccountToTeam: (id: string, accountId: string, seat: SeatType) =>
    call<SubaccountView>('POST', `/subaccounts/${id}/team-invites`, { accountId, seat }),
  leaveSubaccountTeam: (id: string, chatgptAccountId: string) =>
    call<SubaccountView>('DELETE', `/subaccounts/${id}/team-links/${encodeURIComponent(chatgptAccountId)}`),
  syncSubaccountTeamLinks: (id: string) => call<SubaccountView>('POST', `/subaccounts/${id}/team-links/sync`)
};
