import type {
  ChatGptSessionInput,
  SubaccountRegistrationJobStatus,
  SubaccountRegistrationJobView
} from '@team-manager/shared';

export interface AccountRegistrationRequest {
  mailGroup?: string;
  email?: string;
  password?: string;
}

interface AccountOperationResponse {
  id: string;
  accountId?: string;
  type: string;
  status: string;
  phase: string;
  message?: string;
  email?: string;
  progress: number;
  errorCode?: string;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface AccountManagerGateway {
  health(): Promise<{ status?: string; accountRegistrationConfigured?: boolean }>;
  listRegistrations(): Promise<SubaccountRegistrationJobView[]>;
  startRegistration(input: AccountRegistrationRequest): Promise<SubaccountRegistrationJobView>;
  retryRegistration(id: string): Promise<SubaccountRegistrationJobView>;
  removeOperation(id: string): Promise<boolean>;
  session(accountId: string): Promise<ChatGptSessionInput>;
}

export class AccountManagerClient implements AccountManagerGateway {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async health(): Promise<{ status?: string; accountRegistrationConfigured?: boolean }> {
    const response = await this.fetchImpl(`${this.baseUrl}/health`);
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new AccountManagerError(response.status, `Account Manager 健康检查失败: ${response.status}`);
    return {
      status: typeof data.status === 'string' ? data.status : undefined,
      accountRegistrationConfigured: data.accountRegistrationConfigured === true
    };
  }

  async listRegistrations(): Promise<SubaccountRegistrationJobView[]> {
    const operations = await this.request<AccountOperationResponse[]>('GET', '/v1/operations?type=register');
    return operations.map(toRegistrationJob);
  }

  async startRegistration(input: AccountRegistrationRequest): Promise<SubaccountRegistrationJobView> {
    return toRegistrationJob(await this.request('POST', '/v1/accounts/register', input));
  }

  async retryRegistration(id: string): Promise<SubaccountRegistrationJobView> {
    return toRegistrationJob(await this.request('POST', `/v1/operations/${encodeURIComponent(id)}/retry`, {}));
  }

  removeOperation(id: string): Promise<boolean> {
    return this.request('DELETE', `/v1/operations/${encodeURIComponent(id)}`);
  }

  session(accountId: string): Promise<ChatGptSessionInput> {
    return this.request('GET', `/v1/accounts/${encodeURIComponent(accountId)}/session`);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
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

function toRegistrationJob(operation: AccountOperationResponse): SubaccountRegistrationJobView {
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

function normalizeRegistrationStatus(status: string): SubaccountRegistrationJobStatus {
  if (
    status === 'queued' || status === 'running' || status === 'waiting_manual' ||
    status === 'succeeded' || status === 'failed' || status === 'interrupted'
  ) return status;
  return 'running';
}
