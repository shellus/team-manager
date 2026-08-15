import type {
  AccountActivityView,
  AccountRegistrationSummaryView,
  AccountGroupView,
  AccountManagerStateView,
  AccountManagerOperationView,
  AddPersonalPaymentMethodRequest,
  ArtifactIndexView,
  BillingDetailView,
  BulkUpdateAccountsRequest,
  BulkUpdateAccountsResult,
  ChangePersonalSubscriptionRequest,
  CodexAuthStart,
  CredentialPoolGroupView,
  NotificationDeliveryView,
  NotificationPolicyView,
  SaveNotificationPolicyRequest,
  OpenBusinessSubscriptionRequest,
  SubscriptionDetailView,
  OperationControl,
  OperationDetailView,
  PersonalSpaceDetailView,
  PersonalPaymentMethodDefaults,
  QuarantinedCredentialClaimInput,
  RegisterAccountRequest,
  ResidentialProxyConfig,
  SeatSlotMutationInput,
  UnifiedAccountDetailView,
  UnifiedAccountSummaryView,
  WorkspaceDetailView,
  WorkspaceInvitationMutationInput,
  WorkspaceMemberRemovalResult,
  WorkspacePromotionApplyResultView,
  WorkspacePromotionPreviewView,
  RenewalOperationalOverviewView,
  SeatOperationalOverviewView,
  TeamOrderDashboardView,
  WorkspaceSummaryView,
} from '@team-manager/shared';
import { ApiError, expireAuthentication, getToken } from './api.js';

export interface PageResult<T> {
  items: T[];
  total?: number;
}
export interface JsonSnapshot {
  payload: Record<string, unknown>;
  observedAt?: string;
  raw?: unknown;
}
export type ArtifactView = ArtifactIndexView;
export type SeatSlotInput = SeatSlotMutationInput;
export type { AccountActivityView, CredentialPoolGroupView, NotificationDeliveryView, NotificationPolicyView, PersonalSpaceDetailView };

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
  const response = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    data?: T;
    error?: string;
  };
  if (!response.ok || payload.ok !== true) {
    if (response.status === 401) expireAuthentication();
    throw new ApiError(response.status, payload.error ?? `请求失败 ${response.status}`, path);
  }
  return payload.data as T;
}

async function requestBytes(method: string, path: string, body: Uint8Array, headers: Record<string, string>): Promise<{ id: string }> {
  const token = getToken();
  const response = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: new Blob([body as Uint8Array<ArrayBuffer>]),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    data?: string | { id: string };
    error?: string;
  };
  if (!response.ok || payload.ok !== true) {
    if (response.status === 401) expireAuthentication();
    throw new ApiError(response.status, payload.error ?? `请求失败 ${response.status}`, path);
  }
  return typeof payload.data === 'string' ? { id: payload.data } : payload.data!;
}
async function requestRaw(path: string): Promise<Blob> {
  const token = getToken();
  const response = await fetch(`/api${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (response.status === 401) expireAuthentication();
  if (!response.ok) throw new ApiError(response.status, await response.text(), path);
  return response.blob();
}

export const unifiedApi = {
  groups: () => request<AccountGroupView[]>('GET', '/account-groups'),
  createGroup: (name: string) => request<AccountGroupView[]>('POST', '/account-groups', { name }),
  renameGroup: (id: string, name: string) => request<AccountGroupView[]>('PATCH', `/account-groups/${id}`, { name }),
  deleteGroup: (id: string) => request<AccountGroupView[]>('DELETE', `/account-groups/${id}`),
  reorderGroups: (ids: string[]) => request<AccountGroupView[]>('PUT', '/account-groups/order', { ids }),
  accounts: (query: URLSearchParams) => request<UnifiedAccountSummaryView[]>('GET', `/accounts?${query}`),
  accountRegistrations: (query: URLSearchParams) => request<AccountRegistrationSummaryView[]>('GET', `/account-registrations?${query}`),
  account: (id: string) => request<UnifiedAccountDetailView>('GET', `/accounts/${id}`),
  accountWorkspace: (accountId: string, workspaceId: string) =>
    request<WorkspaceDetailView>('GET', `/accounts/${accountId}/workspaces/${workspaceId}`),
  createAccount: (body: Record<string, unknown>) => request<UnifiedAccountDetailView>('POST', '/accounts', body),
  updateAccount: (id: string, body: Record<string, unknown>) => request<UnifiedAccountDetailView>('PATCH', `/accounts/${id}`, body),
  bulkUpdateAccounts: (body: BulkUpdateAccountsRequest) => request<BulkUpdateAccountsResult>('PATCH', '/accounts/bulk', body),
  deleteAccount: (id: string) => request<boolean>('DELETE', `/accounts/${id}`),
  changePersonalSubscription: (id: string, body: ChangePersonalSubscriptionRequest) => request<AccountManagerOperationView>('POST', `/accounts/${id}/personal-subscription`, body),
  cancelPersonalRenewal: (id: string) => request<AccountManagerOperationView>('POST', `/accounts/${id}/personal-subscription/cancel-renewal`),
  openBusiness: (id: string, body: OpenBusinessSubscriptionRequest) => request<AccountManagerOperationView>('POST', `/accounts/${id}/business-subscription`, body),
  accountManagerState: (id: string) => request<AccountManagerStateView>('GET', `/accounts/${id}/account-manager`),
  enrollAccountManager: (id: string) => request<AccountManagerOperationView>('POST', `/accounts/${id}/account-manager/enroll`),
  syncAccountManager: (id: string) => request<AccountManagerStateView>('POST', `/accounts/${id}/account-manager/sync`),
  startProfile: (id: string) => request<unknown>('POST', `/accounts/${id}/account-manager/profile/start`),
  stopProfile: (id: string) => request<unknown>('POST', `/accounts/${id}/account-manager/profile/stop`),
  configureProxy: (id: string, body: ResidentialProxyConfig) => request<ResidentialProxyConfig>('PUT', `/accounts/${id}/account-manager/proxy`, body),
  importGamSession: (id: string) => request<unknown>('POST', `/accounts/${id}/account-manager/session/import`),
  personalPaymentMethodDefaults: (id: string) => request<PersonalPaymentMethodDefaults>('GET', `/accounts/${id}/personal-payment-method-defaults`),
  accountSession: (id: string) => request<Record<string, unknown>>('GET', `/accounts/${id}/session`),
  personalSpace: (id: string) => request<PersonalSpaceDetailView>('GET', `/accounts/${id}/personal-space`),
  updatePersonalSettings: (id: string, body: Record<string, unknown>) => request<PersonalSpaceDetailView>('PATCH', `/accounts/${id}/personal-space/settings`, body),
  refreshPersonalSpace: (id: string, resource?: string) => request<PersonalSpaceDetailView>('POST', `/accounts/${id}/personal-space/refresh`, resource ? { resources: [resource] } : {}),
  accountActivity: (id: string) => request<AccountActivityView[]>('GET', `/accounts/${id}/personal-space/activity`),
  addPaymentMethod: (id: string, body: AddPersonalPaymentMethodRequest) => request<AccountManagerOperationView>('POST', `/accounts/${id}/personal-payment-methods`, body),
  registerAccount: (body: RegisterAccountRequest) => request<AccountManagerOperationView>('POST', '/operations/registrations', body),
  registration: (id: string) => request<{ operation: AccountManagerOperationView; accountId?: string }>('GET', `/operations/registrations/${id}`),
  registrationProxy: (id: string) => request<ResidentialProxyConfig>('GET', `/operations/registrations/${id}/proxy`),
  configureRegistrationProxy: (id: string, body: ResidentialProxyConfig) => request<ResidentialProxyConfig>('PUT', `/operations/registrations/${id}/proxy`, body),
  operation: (id: string) => request<OperationDetailView>('GET', `/operations/${id}`),
  controlOperation: (id: string, control: OperationControl) => request<AccountManagerOperationView>('POST', `/operations/${id}/controls/${encodeURIComponent(control)}`),
  supplyOperationCard: (id: string, body: Record<string, unknown>) => request<AccountManagerOperationView>('PUT', `/operations/${id}/payment-card`, body),
  deleteOperation: (id: string) => request<boolean>('DELETE', `/operations/${id}`),
  workspaces: (query = '') => request<WorkspaceSummaryView[]>('GET', `/workspaces${query ? `?query=${encodeURIComponent(query)}` : ''}`),
  refreshWorkspacePeople: (id: string, executorAccountId: string) => request<WorkspaceDetailView>('POST', `/workspaces/${id}/people/refresh`, { executorAccountId }),
  refreshWorkspaceSettings: (id: string, executorAccountId: string) => request<WorkspaceDetailView>('POST', `/workspaces/${id}/settings/refresh`, { executorAccountId }),
  renameWorkspace: (id: string, executorAccountId: string, name: string) => request<unknown>('PATCH', `/workspaces/${id}`, { executorAccountId, name }),
  invite: (id: string, body: WorkspaceInvitationMutationInput & { executorAccountId: string }) => request<unknown>('POST', `/workspaces/${id}/invitations`, body),
  revokeInvitation: (id: string, executorAccountId: string, email: string) =>
    request<unknown>('DELETE', `/workspaces/${id}/invitations`, {
      executorAccountId,
      email,
    }),
  patchMember: (id: string, remoteUserId: string, body: Record<string, unknown>) => request<unknown>('PATCH', `/workspaces/${id}/members/${encodeURIComponent(remoteUserId)}`, body),
  patchWorkspaceSettings: (id: string, body: Record<string, unknown>) => request<unknown>('PATCH', `/workspaces/${id}/settings`, body),
  removeMember: (id: string, remoteUserId: string, executorAccountId: string) => request<WorkspaceMemberRemovalResult>('DELETE', `/workspaces/${id}/members/${encodeURIComponent(remoteUserId)}`, { executorAccountId }),
  workspaceBilling: (id: string, executorAccountId?: string) =>
    request<BillingDetailView | undefined>('GET', `/workspaces/${id}/billing${executorAccountId ? `?executorAccountId=${encodeURIComponent(executorAccountId)}` : ''}`),
  refreshWorkspaceBilling: (id: string, executorAccountId: string) => request<WorkspaceDetailView>('POST', `/workspaces/${id}/billing/refresh`, { executorAccountId }),
  workspaceInvoice: (id: string, invoiceId: string) => request<Record<string, unknown>>('GET', `/workspaces/${id}/billing/invoices/${encodeURIComponent(invoiceId)}`),
  workspaceSubscription: (id: string, executorAccountId?: string) =>
    request<SubscriptionDetailView | undefined>('GET', `/workspaces/${id}/subscription${executorAccountId ? `?executorAccountId=${encodeURIComponent(executorAccountId)}` : ''}`),
  previewWorkspacePromotion: (id: string, executorAccountId: string, promoCode: string) =>
    request<WorkspacePromotionPreviewView>('POST', `/workspaces/${id}/promotion/preview`, { executorAccountId, promoCode }),
  applyWorkspacePromotion: (id: string, executorAccountId: string, promoCode: string, acknowledgeRenewal: boolean) =>
    request<WorkspacePromotionApplyResultView>('POST', `/workspaces/${id}/promotion/apply`, { executorAccountId, promoCode, acknowledgeRenewal }),
  createSeatSlot: (workspaceId: string, executorAccountId: string, body: SeatSlotInput) => request<unknown>('POST', `/workspaces/${workspaceId}/seat-slots`, { ...body, executorAccountId }),
  updateSeatSlot: (workspaceId: string, slotId: string, executorAccountId: string, body: Partial<SeatSlotInput>) => request<unknown>('PATCH', `/workspaces/${workspaceId}/seat-slots/${slotId}`, { ...body, executorAccountId }),
  deleteSeatSlot: (workspaceId: string, slotId: string, executorAccountId: string) => request<boolean>('DELETE', `/workspaces/${workspaceId}/seat-slots/${slotId}`, { executorAccountId }),
  releaseSeatSlot: (workspaceId: string, slotId: string, executorAccountId: string) => request<unknown>('POST', `/workspaces/${workspaceId}/seat-slots/${slotId}/release`, { executorAccountId }),
  teamOrders: () => request<TeamOrderDashboardView>('GET', '/team-orders'),
  saveTeamOrderConfiguration: (body: Record<string, unknown>) => request<void>('PUT', '/team-orders/configuration', body),
  saveTeamOrderMaintenance: (workspaceId: string, body: Record<string, unknown>) => request<void>('PUT', `/team-orders/maintenances/${workspaceId}`, body),
  runTeamOrders: (body: Record<string, unknown>) => request<unknown>('POST', '/team-orders/run', body),
  controlTeamOrder: (workspaceId: string, action: string) => request<unknown>('POST', `/team-orders/maintenances/${workspaceId}/${encodeURIComponent(action)}`),
  retryTeamOrder: (id: string) => request<unknown>('POST', `/team-orders/orders/${id}/retry`),
  deleteTeamOrder: (id: string) => request<boolean>('DELETE', `/team-orders/orders/${id}`),
  notificationPolicies: () => request<NotificationPolicyView[]>('GET', '/settings/notification-policies'),
  saveNotificationPolicy: (kind: string, body: SaveNotificationPolicyRequest) => request<NotificationPolicyView[]>('PUT', `/settings/notification-policies/${encodeURIComponent(kind)}`, body),
  testNotificationPolicy: (kind: string) => request<NotificationDeliveryView>('POST', `/settings/notification-policies/${encodeURIComponent(kind)}/test`),
  notificationDeliveries: () => request<NotificationDeliveryView[]>('GET', '/settings/notification-deliveries'),
  retryNotificationDelivery: (id: string) => request<NotificationDeliveryView>('POST', `/settings/notification-deliveries/${id}/retry`),
  systemSettings: () => request<Array<{ key: string; value?: Record<string, unknown> }>>('GET', '/settings/system'),
  saveSystemSetting: (key: string, value: Record<string, unknown>) => request<Record<string, unknown>>('PUT', `/settings/system/${encodeURIComponent(key)}`, value),
  createPatCredential: (accountId: string, workspaceId: string, body: Record<string, unknown>) =>
    request<{ id: string }>('POST', `/accounts/${accountId}/workspaces/${workspaceId}/credentials/pat`, body),
  createOauthCredential: (accountId: string, workspaceId: string) => request<CodexAuthStart>('POST', `/accounts/${accountId}/workspaces/${workspaceId}/credentials/oauth`),
  completeOauthCredential: (sessionId: string, callbackUrl: string, poolGroupId?: string) =>
    request<{ id: string }>('PUT', `/credentials/oauth/${sessionId}`, {
      callbackUrl,
      poolGroupId,
    }),
  updateCredential: (credentialId: string, body: Record<string, unknown>) => request<unknown>('PATCH', `/credentials/${credentialId}`, body),
  deployCredential: (credentialId: string, body: Record<string, unknown>) => request<unknown>('POST', `/credentials/${credentialId}/deploy`, body),
  deleteCredential: (credentialId: string) => request<boolean>('DELETE', `/credentials/${credentialId}`),
  refreshCredentialQuota: (credentialId: string) => request<unknown>('POST', `/credentials/${credentialId}/quota/refresh`),
  credentialPoolGroups: () => request<CredentialPoolGroupView[]>('GET', '/credential-pool-groups'),
  createCredentialPoolGroup: (name: string) =>
    request<CredentialPoolGroupView[]>('POST', '/credential-pool-groups', {
      name,
    }),
  updateCredentialPoolGroup: (id: string, body: Record<string, unknown>) => request<CredentialPoolGroupView[]>('PATCH', `/credential-pool-groups/${id}`, body),
  deleteCredentialPoolGroup: (id: string) => request<CredentialPoolGroupView[]>('DELETE', `/credential-pool-groups/${id}`),
  overviewRenewals: () => request<RenewalOperationalOverviewView[]>('GET', '/overview/renewals'),
  overviewSeats: () => request<SeatOperationalOverviewView[]>('GET', '/overview/seats'),
  artifacts: (query: URLSearchParams) => request<ArtifactView[]>('GET', `/artifacts?${query}`),
  uploadRrweb: (body: Uint8Array, fileName: string, recordedAt: string) =>
    requestBytes('POST', '/artifacts/rrweb', body, {
      'Content-Type': 'application/gzip',
      'x-artifact-file-name': fileName,
      'x-recorded-at': recordedAt,
    }),
  artifactContent: (kind: string, id: string) => requestRaw(`/artifacts/${encodeURIComponent(kind)}/${id}`),
  deleteArtifact: (kind: string, id: string) => request<boolean>('DELETE', `/artifacts/${encodeURIComponent(kind)}/${id}`),
  claimQuarantinedCredential: (id: string, body: QuarantinedCredentialClaimInput) => request<unknown>('POST', `/artifacts/quarantine/${id}/claim`, body),
  discardQuarantinedCredential: (id: string) => request<unknown>('DELETE', `/artifacts/quarantine/${id}`),
};
