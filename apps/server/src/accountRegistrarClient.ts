import type { ChatGptSessionInput, SubaccountRegistrationJobView } from '@team-manager/shared';

export interface AccountRegistrationDelivery {
  email: string;
  password: string;
  name?: string;
  birthdate?: string;
  callbackUrl?: string;
  session: ChatGptSessionInput;
  registrationMethod: 'cloak_browser';
  cloakProfileId?: string;
  cloakProfileName?: string;
  registeredAt: number;
  mailbox?: { email: string; group: string };
  mailboxError?: string;
  events: Array<Record<string, unknown> & { phase?: string }>;
}

export interface AccountRegistrationRequest {
  mailGroup?: string;
  email?: string;
  password?: string;
}

export interface AccountRegistrarGateway {
  health(): Promise<{ status?: string; registrationConfigured?: boolean }>;
  list(): Promise<SubaccountRegistrationJobView[]>;
  start(input: AccountRegistrationRequest): Promise<SubaccountRegistrationJobView>;
  retry(id: string): Promise<SubaccountRegistrationJobView>;
  remove(id: string): Promise<boolean>;
  result(id: string): Promise<AccountRegistrationDelivery>;
}

export class AccountRegistrarClient implements AccountRegistrarGateway {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async health(): Promise<{ status?: string; registrationConfigured?: boolean }> {
    const response = await this.fetchImpl(`${this.baseUrl}/health`);
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new AccountRegistrarError(response.status, `注册服务健康检查失败: ${response.status}`);
    return {
      status: typeof data.status === 'string' ? data.status : undefined,
      registrationConfigured: data.registrationConfigured === true
    };
  }

  list(): Promise<SubaccountRegistrationJobView[]> {
    return this.request('GET', '/v1/registrations');
  }

  start(input: AccountRegistrationRequest): Promise<SubaccountRegistrationJobView> {
    return this.request('POST', '/v1/registrations', input);
  }

  retry(id: string): Promise<SubaccountRegistrationJobView> {
    return this.request('POST', `/v1/registrations/${encodeURIComponent(id)}/retry`, {});
  }

  remove(id: string): Promise<boolean> {
    return this.request('DELETE', `/v1/registrations/${encodeURIComponent(id)}`);
  }

  result(id: string): Promise<AccountRegistrationDelivery> {
    return this.request('GET', `/v1/registrations/${encodeURIComponent(id)}/result`);
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
      throw new AccountRegistrarError(response.status, `注册服务返回非 JSON 响应: ${text}`);
    }
    if (!response.ok || parsed.ok !== true || parsed.data === undefined) {
      throw new AccountRegistrarError(response.status, parsed.error || `注册服务请求失败: ${response.status}`);
    }
    return parsed.data;
  }
}

export class AccountRegistrarError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'AccountRegistrarError';
  }
}

export function createAccountRegistrarClient(): AccountRegistrarClient | undefined {
  const baseUrl = process.env.TEAMMGR_REGISTRAR_BASE_URL?.trim().replace(/\/+$/, '');
  const token = process.env.TEAMMGR_REGISTRAR_TOKEN?.trim();
  return baseUrl && token ? new AccountRegistrarClient(baseUrl, token) : undefined;
}
