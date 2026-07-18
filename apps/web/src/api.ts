import type {
  AccountBillingSnapshot,
  AccountLimitType,
  AccountSeatSlotProfileInput,
  AccountView,
  EditableMemberRole,
  Member,
  NotificationSettings,
  PublicSeatSlotView,
  PendingInvite,
  SeatType,
  ApiResult,
  SubaccountAuthLog,
  SubaccountRegistrationJobView,
  SubaccountView,
  SubaccountRegistrationRuntimeStatus,
  CodexCredentialJson,
  CodexQuotaSnapshot
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
  listAccounts: () => call<AccountView[]>('GET', '/accounts'),
  refreshAccount: (id: string) => call<AccountView>('POST', `/accounts/${id}/refresh`),
  renameTeam: (id: string, name: string) => call<AccountView>('PATCH', `/accounts/${id}/name`, { name }),
  updateAccountLocalProfile: (
    id: string,
    payload: {
      remark?: string;
      groupName?: string;
      limitType?: AccountLimitType;
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
    seatSlotProfile: AccountSeatSlotProfileInput | undefined,
    confirmBillingRisk = false
  ) =>
    call<AccountView>('POST', `/accounts/${id}/invites`, { email, seat, seatSlotProfile, confirmBillingRisk }),
  listPendingInvites: (id: string) => call<PendingInvite[]>('GET', `/accounts/${id}/invites`),
  refreshPendingInvites: (id: string) => call<AccountView>('POST', `/accounts/${id}/invites/refresh`),
  revokePendingInvite: (id: string, email: string) =>
    call<AccountView>('DELETE', `/accounts/${id}/invites`, { email }),
  updateSeatSlotProfile: (
    id: string,
    payload: { email: string } & AccountSeatSlotProfileInput
  ) => call<AccountView>('PATCH', `/accounts/${id}/seat-slots/profile`, payload),
  removeMember: (id: string, userId: string) => call<AccountView>('DELETE', `/accounts/${id}/members/${userId}`),
  setMemberSeat: (id: string, userId: string, seat: SeatType, confirmBillingRisk = false) =>
    call<AccountView>('PATCH', `/accounts/${id}/members/${userId}`, { seat, confirmBillingRisk }),
  setMemberRole: (
    id: string,
    userId: string,
    role: EditableMemberRole,
    confirmOwnerRisk = false
  ) =>
    call<AccountView>('PATCH', `/accounts/${id}/members/${userId}/role`, {
      role,
      confirmOwnerRisk
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
  getNotificationSettings: () => call<NotificationSettings>('GET', '/settings/notifications'),
  updateNotificationSettings: (payload: NotificationSettings) =>
    call<NotificationSettings>('PATCH', '/settings/notifications', payload),
  listSubaccounts: () => call<SubaccountView[]>('GET', '/subaccounts'),
  importSubaccountSession: (payload: {
    session: unknown;
    remark?: string;
    groupName?: string;
    proxy?: string;
  } | unknown) =>
    call<SubaccountView>('POST', '/subaccounts/session', payload),
  listSubaccountRegistrationJobs: () =>
    call<SubaccountRegistrationJobView[]>('GET', '/subaccounts/registration/jobs'),
  retrySubaccountRegistration: (jobId: string) =>
    call<SubaccountRegistrationJobView>('POST', `/subaccounts/registration/jobs/${jobId}/retry`),
  registerSubaccount: (payload: { mailGroup?: string } = {}) =>
    call<SubaccountRegistrationJobView>('POST', '/subaccounts/registration/start', payload),
  updateSubaccountLocalProfile: (
    id: string,
    payload: { remark?: string; groupName?: string; proxy?: string; session?: unknown }
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
    call<SubaccountRegistrationRuntimeStatus>('GET', '/subaccounts/registration/status'),
  createSubaccountPersonalAccessTokenCredential: (id: string, chatgptAccountId?: string) =>
    call<SubaccountView>('POST', `/subaccounts/${id}/pat-credentials`, { chatgptAccountId }),
  getSubaccountCodexCredential: (id: string, chatgptAccountId?: string) => {
    const suffix = chatgptAccountId ? `?chatgptAccountId=${encodeURIComponent(chatgptAccountId)}` : '';
    return call<CodexCredentialJson>('GET', `/subaccounts/${id}/pat-credentials${suffix}`);
  },
  removeSubaccountCodexCredential: (id: string, chatgptAccountId: string) =>
    call<SubaccountView>(
      'DELETE',
      `/subaccounts/${id}/pat-credentials?chatgptAccountId=${encodeURIComponent(chatgptAccountId)}`
    ),
  refreshSubaccountQuota: (id: string, chatgptAccountId?: string) =>
    call<CodexQuotaSnapshot>('POST', `/subaccounts/${id}/quota/refresh`, { chatgptAccountId }),
  listSubaccountLogs: (id: string) => call<SubaccountAuthLog[]>('GET', `/subaccounts/${id}/logs`),
  listAllSubaccountLogs: () => call<SubaccountAuthLog[]>('GET', '/subaccounts/logs'),
  inviteSubaccountToTeam: (id: string, accountId: string, seat: SeatType, confirmBillingRisk = false) =>
    call<SubaccountView>('POST', `/subaccounts/${id}/team-invites`, { accountId, seat, confirmBillingRisk }),
  leaveSubaccountTeam: (id: string, chatgptAccountId: string) =>
    call<SubaccountView>('DELETE', `/subaccounts/${id}/team-links/${encodeURIComponent(chatgptAccountId)}`),
  syncSubaccountTeamLinks: (id: string) => call<SubaccountView>('POST', `/subaccounts/${id}/team-links/sync`)
};
