import type {
  AccountGroupView,
  AccountManagerOperationView,
  ChangePersonalSubscriptionRequest,
  OpenBusinessSubscriptionRequest,
  UnifiedAccountDetailView,
  UnifiedAccountSummaryView,
  WorkspaceDetailView,
  WorkspaceSummaryView
} from '@team-manager/shared';
import { ApiError, clearToken, getToken } from './api.js';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
  const response = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const payload = await response.json().catch(() => ({})) as { ok?: boolean; data?: T; error?: string };
  if (!response.ok || payload.ok !== true) {
    if (response.status === 401) clearToken();
    throw new ApiError(response.status, payload.error ?? `请求失败 ${response.status}`, path);
  }
  return payload.data as T;
}

export const unifiedApi = {
  groups: () => request<AccountGroupView[]>('GET', '/account-groups'),
  createGroup: (name: string) => request<AccountGroupView[]>('POST', '/account-groups', { name }),
  renameGroup: (id: string, name: string) => request<AccountGroupView[]>('PATCH', `/account-groups/${id}`, { name }),
  deleteGroup: (id: string) => request<AccountGroupView[]>('DELETE', `/account-groups/${id}`),
  accounts: (query: URLSearchParams) => request<UnifiedAccountSummaryView[]>('GET', `/accounts?${query}`),
  account: (id: string) => request<UnifiedAccountDetailView>('GET', `/accounts/${id}`),
  createAccount: (body: Record<string, unknown>) => request<UnifiedAccountDetailView>('POST', '/accounts', body),
  updateAccount: (id: string, body: Record<string, unknown>) => request<UnifiedAccountDetailView>('PATCH', `/accounts/${id}`, body),
  deleteAccount: (id: string) => request<boolean>('DELETE', `/accounts/${id}`),
  changePersonalSubscription: (id: string, body: ChangePersonalSubscriptionRequest) =>
    request<AccountManagerOperationView>('POST', `/accounts/${id}/personal-subscription`, body),
  cancelPersonalRenewal: (id: string) => request<AccountManagerOperationView>('POST', `/accounts/${id}/personal-subscription/cancel-renewal`),
  openBusiness: (id: string, body: OpenBusinessSubscriptionRequest) =>
    request<AccountManagerOperationView>('POST', `/accounts/${id}/business-subscription`, body),
  workspaces: (query = '') => request<WorkspaceSummaryView[]>('GET', `/workspaces${query ? `?query=${encodeURIComponent(query)}` : ''}`),
  workspace: (id: string) => request<WorkspaceDetailView>('GET', `/workspaces/${id}`),
  refreshWorkspace: (id: string, executorAccountId: string) => request<unknown>('POST', `/workspaces/${id}/refresh`, { executorAccountId }),
  renameWorkspace: (id: string, executorAccountId: string, name: string) => request<unknown>('PATCH', `/workspaces/${id}`, { executorAccountId, name }),
  invite: (id: string, body: Record<string, unknown>) => request<unknown>('POST', `/workspaces/${id}/invitations`, body),
  removeMember: (id: string, remoteUserId: string, executorAccountId: string) =>
    request<unknown>('DELETE', `/workspaces/${id}/members/${encodeURIComponent(remoteUserId)}`, { executorAccountId })
};
