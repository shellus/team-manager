import type {
  AccountManagerOperationStatus,
  AccountManagerOperationView,
  AccountManagerProfileView,
  ChangePersonalSubscriptionRequest,
  ChatGptSessionInput,
  OpenBusinessSubscriptionRequest,
  ResidentialProxyConfig,
  OperationControl,
  PaymentCardInput
} from '@team-manager/shared';
import { fetchWithRawTrace } from './transport.js';

export interface AccountRegistrationRequest {
  mailGroup?: string;
  email?: string;
  password?: string;
  resumeExisting?: boolean;
  country?: string;
  requestTag?: string;
  clientReference?: string;
}

export interface AccountImportRequest {
  email: string;
  authMethod: 'existing_session';
  session: ChatGptSessionInput;
  requestTag?: string;
  clientReference?: string;
}

export interface RegistrationSessionDelivery {
  email: string;
  session: ChatGptSessionInput;
}

export interface AccountManagerGateway {
  startRegistration?(input: AccountRegistrationRequest): Promise<AccountManagerOperationView>;
  startAccountImport?(input: AccountImportRequest): Promise<AccountManagerOperationView>;
  operation?(operationId: string): Promise<AccountManagerOperationView>;
  controlOperation?(operationId: string, control: OperationControl): Promise<AccountManagerOperationView>;
  replaceOperationPaymentCard?(operationId: string, card: PaymentCardInput): Promise<AccountManagerOperationView>;
  operationProxyConfig?(operationId: string): Promise<ResidentialProxyConfig>;
  configureOperationProxy?(operationId: string, input: ResidentialProxyConfig): Promise<ResidentialProxyConfig>;
  deleteOperation?(operationId: string): Promise<boolean>;
  registrationSessionDelivery?(operationId: string): Promise<RegistrationSessionDelivery>;
  acknowledgeRegistrationSessionDelivery?(operationId: string): Promise<boolean>;
  listAccountOperations?(accountId: string): Promise<AccountManagerOperationView[]>;
  accountProfile?(accountId: string): Promise<AccountManagerProfileView>;
  startAccountProfile?(accountId: string): Promise<AccountManagerProfileView>;
  stopAccountProfile?(accountId: string): Promise<AccountManagerProfileView>;
  accountProxyConfig?(accountId: string): Promise<ResidentialProxyConfig>;
  accountHttpProxy?(accountId: string): Promise<{ proxy: string }>;
  configureAccountProxy?(accountId: string, input: ResidentialProxyConfig): Promise<ResidentialProxyConfig>;
  changePersonalSubscription?(
    accountId: string,
    input: ChangePersonalSubscriptionRequest & { requestTag?: string }
  ): Promise<AccountManagerOperationView>;
  openBusinessSubscription?(
    accountId: string,
    input: OpenBusinessSubscriptionRequest & { requestTag?: string }
  ): Promise<AccountManagerOperationView>;
}

interface RawOperation extends Omit<AccountManagerOperationView, 'status' | 'requestSummary' | 'result'> {
  status: string;
  requestSummary?: unknown;
  result?: unknown;
}

export class AccountManagerClient implements AccountManagerGateway {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl?: typeof fetch
  ) {}

  async startRegistration(input: AccountRegistrationRequest): Promise<AccountManagerOperationView> {
    return toOperation(await this.request('POST', '/v1/accounts/register', input));
  }

  async startAccountImport(input: AccountImportRequest): Promise<AccountManagerOperationView> {
    return toOperation(await this.request('POST', '/v1/accounts/imports', input));
  }

  async operation(operationId: string): Promise<AccountManagerOperationView> {
    return toOperation(await this.request('GET', `/v1/operations/${encodeURIComponent(operationId)}`));
  }

  async controlOperation(operationId: string, control: OperationControl): Promise<AccountManagerOperationView> {
    return toOperation(await this.request(
      'POST', `/v1/operations/${encodeURIComponent(operationId)}/controls/${encodeURIComponent(control)}`, {}
    ));
  }

  async replaceOperationPaymentCard(operationId: string, card: PaymentCardInput): Promise<AccountManagerOperationView> {
    return toOperation(await this.request('PUT', `/v1/operations/${encodeURIComponent(operationId)}/payment-card`, { card }));
  }

  operationProxyConfig(operationId: string): Promise<ResidentialProxyConfig> {
    return this.request('GET', `/v1/operations/${encodeURIComponent(operationId)}/proxy`);
  }

  configureOperationProxy(operationId: string, input: ResidentialProxyConfig): Promise<ResidentialProxyConfig> {
    return this.request('PUT', `/v1/operations/${encodeURIComponent(operationId)}/proxy`, input);
  }

  async deleteOperation(operationId: string): Promise<boolean> {
    await this.request('DELETE', `/v1/operations/${encodeURIComponent(operationId)}`);
    return true;
  }

  registrationSessionDelivery(operationId: string): Promise<RegistrationSessionDelivery> {
    return this.request('GET', `/v1/operations/${encodeURIComponent(operationId)}/session-delivery`);
  }

  async acknowledgeRegistrationSessionDelivery(operationId: string): Promise<boolean> {
    await this.request('DELETE', `/v1/operations/${encodeURIComponent(operationId)}/session-delivery`);
    return true;
  }

  async listAccountOperations(accountId: string): Promise<AccountManagerOperationView[]> {
    const items = await this.request<RawOperation[]>('GET', `/v1/accounts/${encodeURIComponent(accountId)}/operations`);
    return items.map(toOperation);
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

  accountHttpProxy(accountId: string): Promise<{ proxy: string }> {
    return this.request('GET', `/v1/accounts/${encodeURIComponent(accountId)}/http-proxy`);
  }

  configureAccountProxy(accountId: string, input: ResidentialProxyConfig): Promise<ResidentialProxyConfig> {
    return this.request('PUT', `/v1/accounts/${encodeURIComponent(accountId)}/proxy`, input);
  }

  async changePersonalSubscription(accountId: string, input: ChangePersonalSubscriptionRequest & { requestTag?: string }) {
    return toOperation(await this.request(
      'POST', `/v1/accounts/${encodeURIComponent(accountId)}/operations/change-personal-subscription`, input
    ));
  }

  async openBusinessSubscription(accountId: string, input: OpenBusinessSubscriptionRequest & { requestTag?: string }) {
    return toOperation(await this.request(
      'POST', `/v1/accounts/${encodeURIComponent(accountId)}/operations/open-business-subscription`, input
    ));
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetchWithRawTrace('account-manager', `${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }, this.fetchImpl);
    const text = await response.text();
    let parsed: { ok?: boolean; data?: T; error?: string };
    try { parsed = JSON.parse(text) as typeof parsed; }
    catch { throw new AccountManagerError(response.status, `GAM 返回非 JSON 响应: ${text.slice(0, 200)}`); }
    if (!response.ok || parsed.ok !== true || parsed.data === undefined) {
      throw new AccountManagerError(response.status, parsed.error || `GAM 请求失败: ${response.status}`);
    }
    return parsed.data;
  }
}

export class AccountManagerError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = 'AccountManagerError'; }
}

function toOperation(operation: RawOperation): AccountManagerOperationView {
  const { requestSummary: _requestSummary, result: _result, ...base } = operation;
  return {
    ...base,
    status: normalizeOperationStatus(operation.status),
    ...(isRecord(operation.requestSummary) ? { requestSummary: operation.requestSummary } : {}),
    ...(isRecord(operation.result) ? { result: operation.result } : {})
  };
}

function normalizeOperationStatus(status: string): AccountManagerOperationStatus {
  return ['queued', 'running', 'waiting_for_otp', 'waiting_manual', 'succeeded', 'failed', 'interrupted'].includes(status)
    ? status as AccountManagerOperationStatus
    : 'running';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
