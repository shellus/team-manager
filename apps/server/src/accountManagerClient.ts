import type {
  AccountManagerOperationStatus,
  AccountManagerOperationView,
  AccountManagerProfileView,
  ChatGptSessionInput,
  OpenCodexSpaceRequest,
  OpenTeamSubscriptionRequest,
  ResidentialProxyConfig,
  SubaccountRegistrationJobStatus,
  SubaccountRegistrationJobView
} from '@team-manager/shared';
import { fetchWithRawTrace } from './transport.js';

export const ACCOUNT_MANAGER_REQUEST_TAGS = {
  parent: 'team-manager:parent',
  subaccount: 'team-manager:subaccount'
} as const;

export interface AccountRegistrationRequest {
  mailGroup?: string;
  email?: string;
  password?: string;
  requestTag?: string;
  clientReference?: string;
}

export interface AccountImportRequest {
  email: string;
  authMethod: 'email_otp' | 'password' | 'existing_session';
  password?: string;
  session?: ChatGptSessionInput;
}

export interface ManagedAccountWorkspace {
  id: string;
  name?: string;
  structure: string;
  planType: string;
  isDeactivated?: boolean;
  visible: boolean;
}

export interface ManagedAccountSummary {
  id: string;
  email: string;
  hasCodexSpace: boolean;
  hasTeamSubscription: boolean;
  workspaces: ManagedAccountWorkspace[];
}

interface RawAccountOperationResponse {
  id: string;
  accountId?: string;
  type: string;
  status: string;
  phase: string;
  message?: string;
  email?: string;
  progress: number;
  control?: AccountManagerOperationView['control'];
  requestSummary?: unknown;
  result?: unknown;
  errorCode?: string;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface AccountManagerOperationFilter {
  type?: string;
  status?: AccountManagerOperationStatus;
  requestTag?: string;
}

export interface AccountManagerGateway {
  health(): Promise<{ status?: string; accountRegistrationConfigured?: boolean }>;
  listAccounts?(): Promise<ManagedAccountSummary[]>;
  listOperations(filter?: AccountManagerOperationFilter): Promise<AccountManagerOperationView[]>;
  operation(id: string): Promise<AccountManagerOperationView>;
  listAccountOperations(accountId: string): Promise<AccountManagerOperationView[]>;
  listRegistrations(requestTag?: string): Promise<SubaccountRegistrationJobView[]>;
  startRegistration(input: AccountRegistrationRequest): Promise<SubaccountRegistrationJobView>;
  startAccountImport(input: AccountImportRequest): Promise<AccountManagerOperationView>;
  retryRegistration(id: string): Promise<SubaccountRegistrationJobView>;
  rotateOperationIp(id: string): Promise<AccountManagerOperationView>;
  operationProxyConfig(id: string): Promise<ResidentialProxyConfig>;
  configureOperationProxy(id: string, input: ResidentialProxyConfig): Promise<ResidentialProxyConfig>;
  terminateOperation(id: string): Promise<AccountManagerOperationView>;
  removeOperation(id: string): Promise<boolean>;
  account(accountId: string): Promise<ManagedAccountSummary>;
  syncAccount(accountId: string): Promise<ManagedAccountSummary>;
  listAccountProfiles?(): Promise<Record<string, AccountManagerProfileView>>;
  accountProfile(accountId: string): Promise<AccountManagerProfileView>;
  startAccountProfile(accountId: string): Promise<AccountManagerProfileView>;
  stopAccountProfile(accountId: string): Promise<AccountManagerProfileView>;
  accountProxyConfig(accountId: string): Promise<ResidentialProxyConfig>;
  configureAccountProxy(accountId: string, input: ResidentialProxyConfig): Promise<ResidentialProxyConfig>;
  session(accountId: string): Promise<ChatGptSessionInput>;
  openCodexSpace(
    accountId: string,
    input: OpenCodexSpaceRequest & { requestTag?: string }
  ): Promise<AccountManagerOperationView>;
  openTeamSubscription(
    accountId: string,
    input: OpenTeamSubscriptionRequest & { requestTag?: string }
  ): Promise<AccountManagerOperationView>;
}

export class AccountManagerClient implements AccountManagerGateway {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl?: typeof fetch
  ) {}

  async health(): Promise<{ status?: string; accountRegistrationConfigured?: boolean }> {
    const response = await fetchWithRawTrace(
      'account-manager',
      `${this.baseUrl}/health`,
      {},
      this.fetchImpl
    );
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new AccountManagerError(response.status, `Account Manager 健康检查失败: ${response.status}`);
    return {
      status: typeof data.status === 'string' ? data.status : undefined,
      accountRegistrationConfigured: data.accountRegistrationConfigured === true
    };
  }

  listAccounts(): Promise<ManagedAccountSummary[]> {
    return this.request('GET', '/v1/accounts');
  }

  async listOperations(filter: AccountManagerOperationFilter = {}): Promise<AccountManagerOperationView[]> {
    const params = new URLSearchParams();
    if (filter.type) params.set('type', filter.type);
    if (filter.status) params.set('status', filter.status);
    const suffix = params.size ? `?${params.toString()}` : '';
    const operations = (await this.request<RawAccountOperationResponse[]>('GET', `/v1/operations${suffix}`))
      .map(toOperation);
    return filter.requestTag
      ? operations.filter((operation) => operation.requestSummary?.requestTag === filter.requestTag)
      : operations;
  }

  async operation(id: string): Promise<AccountManagerOperationView> {
    return toOperation(await this.request('GET', `/v1/operations/${encodeURIComponent(id)}`));
  }

  async listAccountOperations(accountId: string): Promise<AccountManagerOperationView[]> {
    return (await this.request<RawAccountOperationResponse[]>(
      'GET',
      `/v1/accounts/${encodeURIComponent(accountId)}/operations`
    )).map(toOperation);
  }

  async listRegistrations(requestTag?: string): Promise<SubaccountRegistrationJobView[]> {
    const operations = await this.listOperations({ type: 'register', requestTag });
    return operations.map(registrationJobFromOperation);
  }

  async startRegistration(input: AccountRegistrationRequest): Promise<SubaccountRegistrationJobView> {
    return registrationJobFromOperation(toOperation(await this.request('POST', '/v1/accounts/register', input)));
  }

  async startAccountImport(input: AccountImportRequest): Promise<AccountManagerOperationView> {
    return toOperation(await this.request('POST', '/v1/accounts/imports', input));
  }

  async retryRegistration(id: string): Promise<SubaccountRegistrationJobView> {
    return registrationJobFromOperation(toOperation(await this.request(
      'POST',
      `/v1/operations/${encodeURIComponent(id)}/retry`,
      {}
    )));
  }

  async rotateOperationIp(id: string): Promise<AccountManagerOperationView> {
    return toOperation(await this.request(
      'POST',
      `/v1/operations/${encodeURIComponent(id)}/controls/rotate-ip`,
      {}
    ));
  }

  operationProxyConfig(id: string): Promise<ResidentialProxyConfig> {
    return this.request('GET', `/v1/operations/${encodeURIComponent(id)}/proxy`);
  }

  configureOperationProxy(
    id: string,
    input: ResidentialProxyConfig
  ): Promise<ResidentialProxyConfig> {
    return this.request('PUT', `/v1/operations/${encodeURIComponent(id)}/proxy`, input);
  }

  async terminateOperation(id: string): Promise<AccountManagerOperationView> {
    return toOperation(await this.request(
      'POST',
      `/v1/operations/${encodeURIComponent(id)}/controls/terminate`,
      {}
    ));
  }

  removeOperation(id: string): Promise<boolean> {
    return this.request('DELETE', `/v1/operations/${encodeURIComponent(id)}`);
  }

  account(accountId: string): Promise<ManagedAccountSummary> {
    return this.request('GET', `/v1/accounts/${encodeURIComponent(accountId)}`);
  }

  syncAccount(accountId: string): Promise<ManagedAccountSummary> {
    return this.request('POST', `/v1/accounts/${encodeURIComponent(accountId)}/sync`, {});
  }

  listAccountProfiles(): Promise<Record<string, AccountManagerProfileView>> {
    return this.request('GET', '/v1/accounts/profiles');
  }

  accountProfile(accountId: string): Promise<AccountManagerProfileView> {
    return this.request('GET', `/v1/accounts/${encodeURIComponent(accountId)}/profile`);
  }

  startAccountProfile(accountId: string): Promise<AccountManagerProfileView> {
    return this.request('POST', `/v1/accounts/${encodeURIComponent(accountId)}/profile/start`, {});
  }

  stopAccountProfile(accountId: string): Promise<AccountManagerProfileView> {
    return this.request('POST', `/v1/accounts/${encodeURIComponent(accountId)}/profile/stop`, {});
  }

  accountProxyConfig(accountId: string): Promise<ResidentialProxyConfig> {
    return this.request('GET', `/v1/accounts/${encodeURIComponent(accountId)}/proxy`);
  }

  configureAccountProxy(
    accountId: string,
    input: ResidentialProxyConfig
  ): Promise<ResidentialProxyConfig> {
    return this.request('PUT', `/v1/accounts/${encodeURIComponent(accountId)}/proxy`, input);
  }

  session(accountId: string): Promise<ChatGptSessionInput> {
    return this.request('GET', `/v1/accounts/${encodeURIComponent(accountId)}/session`);
  }

  async openCodexSpace(
    accountId: string,
    input: OpenCodexSpaceRequest & { requestTag?: string }
  ): Promise<AccountManagerOperationView> {
    return toOperation(await this.request(
      'POST',
      `/v1/accounts/${encodeURIComponent(accountId)}/operations/open-codex-space`,
      input
    ));
  }

  async openTeamSubscription(
    accountId: string,
    input: OpenTeamSubscriptionRequest & { requestTag?: string }
  ): Promise<AccountManagerOperationView> {
    return toOperation(await this.request(
      'POST',
      `/v1/accounts/${encodeURIComponent(accountId)}/operations/open-team-subscription`,
      input
    ));
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetchWithRawTrace(
      'account-manager',
      `${this.baseUrl}${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      },
      this.fetchImpl
    );
    const text = await response.text();
    let parsed: { ok?: boolean; data?: T; error?: string };
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      throw new AccountManagerError(response.status, `Account Manager 返回非 JSON 响应: ${text}`);
    }
    if (!response.ok || parsed.ok !== true || parsed.data === undefined) {
      throw new AccountManagerError(response.status, parsed.error || `Account Manager 请求失败: ${response.status}`);
    }
    return parsed.data;
  }
}

export class AccountManagerError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'AccountManagerError';
  }
}

export function createAccountManagerClient(): AccountManagerClient | undefined {
  const baseUrl = process.env.TEAMMGR_ACCOUNT_MANAGER_BASE_URL?.trim().replace(/\/+$/, '');
  const token = process.env.TEAMMGR_ACCOUNT_MANAGER_TOKEN?.trim();
  return baseUrl && token ? new AccountManagerClient(baseUrl, token) : undefined;
}

function toOperation(operation: RawAccountOperationResponse): AccountManagerOperationView {
  return {
    id: operation.id,
    ...(operation.accountId ? { accountId: operation.accountId } : {}),
    type: operation.type,
    status: normalizeOperationStatus(operation.status),
    phase: operation.phase,
    ...(operation.message ? { message: operation.message } : {}),
    ...(operation.email ? { email: operation.email } : {}),
    progress: operation.progress,
    ...(operation.control ? { control: operation.control } : {}),
    ...(isRecord(operation.requestSummary) ? { requestSummary: operation.requestSummary } : {}),
    ...(isRecord(operation.result) ? { result: operation.result } : {}),
    ...(operation.errorCode ? { errorCode: operation.errorCode } : {}),
    ...(operation.errorMessage ? { errorMessage: operation.errorMessage } : {}),
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
    ...(operation.completedAt ? { completedAt: operation.completedAt } : {})
  };
}

export function registrationJobFromOperation(
  operation: AccountManagerOperationView
): SubaccountRegistrationJobView {
  const status = normalizeRegistrationStatus(operation.status);
  return {
    id: operation.id,
    status,
    phase: operation.phase,
    message: operation.message || operation.errorMessage || operation.phase,
    progress: operation.progress,
    ...(operation.email || operation.accountId ? { email: operation.email || operation.accountId } : {}),
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
    ...(operation.completedAt ? { completedAt: operation.completedAt } : {}),
    ...(operation.errorMessage ? { error: operation.errorMessage } : {})
  };
}

function normalizeOperationStatus(status: string): AccountManagerOperationStatus {
  if (
    status === 'queued' || status === 'running' || status === 'waiting_for_otp' ||
    status === 'waiting_manual' || status === 'succeeded' || status === 'failed' || status === 'interrupted'
  ) return status;
  return 'running';
}

function normalizeRegistrationStatus(status: AccountManagerOperationStatus): SubaccountRegistrationJobStatus {
  if (
    status === 'queued' || status === 'running' || status === 'waiting_manual' ||
    status === 'succeeded' || status === 'failed' || status === 'interrupted'
  ) return status;
  return 'running';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
