import type {
  AccountManagerOperationStatus,
  AccountManagerOperationView,
  AccountManagerProfileView,
  AddPersonalPaymentMethodRequest,
  ChangePersonalSubscriptionRequest,
  ChatGptSessionInput,
  OpenBusinessSubscriptionRequest,
  PersonalPaymentMethodDefaults,
  PersonalPaymentMethodView,
  ResidentialProxyConfig,
  ManagedPersonalSubscription,
  ManagedWorkspaceSummary,
  OperationControl,
  PaymentCardInput
} from '@team-manager/shared';
import { fetchWithRawTrace } from './transport.js';

export interface ManagedAccountSummary {
  id: string;
  email: string;
  personalPlan?: string;
  personalSubscription?: ManagedPersonalSubscription;
  paymentMethods?: PersonalPaymentMethodView[];
  workspaces?: ManagedWorkspaceSummary[];
}

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

export interface AccountManagerGateway {
  health?(): Promise<{ status?: string; accountRegistrationConfigured?: boolean }>;
  startRegistration?(input: AccountRegistrationRequest): Promise<AccountManagerOperationView>;
  startAccountImport?(input: AccountImportRequest): Promise<AccountManagerOperationView>;
  operation?(operationId: string): Promise<AccountManagerOperationView>;
  controlOperation?(operationId: string, control: OperationControl): Promise<AccountManagerOperationView>;
  replaceOperationPaymentCard?(operationId: string, card: PaymentCardInput): Promise<AccountManagerOperationView>;
  operationProxyConfig?(operationId: string): Promise<ResidentialProxyConfig>;
  configureOperationProxy?(operationId: string, input: ResidentialProxyConfig): Promise<ResidentialProxyConfig>;
  deleteOperation?(operationId: string): Promise<boolean>;
  account?(accountId: string): Promise<ManagedAccountSummary>;
  syncAccount?(accountId: string): Promise<ManagedAccountSummary>;
  listAccountOperations?(accountId: string): Promise<AccountManagerOperationView[]>;
  accountProfile?(accountId: string): Promise<AccountManagerProfileView>;
  startAccountProfile?(accountId: string): Promise<AccountManagerProfileView>;
  stopAccountProfile?(accountId: string): Promise<AccountManagerProfileView>;
  accountProxyConfig?(accountId: string): Promise<ResidentialProxyConfig>;
  configureAccountProxy?(accountId: string, input: ResidentialProxyConfig): Promise<ResidentialProxyConfig>;
  session?(accountId: string): Promise<ChatGptSessionInput>;
  changePersonalSubscription?(
    accountId: string,
    input: ChangePersonalSubscriptionRequest & { requestTag?: string }
  ): Promise<AccountManagerOperationView>;
  cancelPersonalSubscriptionRenewal?(
    accountId: string,
    input?: { requestTag?: string }
  ): Promise<AccountManagerOperationView>;
  openBusinessSubscription?(
    accountId: string,
    input: OpenBusinessSubscriptionRequest & { requestTag?: string }
  ): Promise<AccountManagerOperationView>;
  addPersonalPaymentMethod?(
    accountId: string,
    input: AddPersonalPaymentMethodRequest & { requestTag?: string }
  ): Promise<AccountManagerOperationView>;
  personalPaymentMethodDefaults?(accountId: string): Promise<PersonalPaymentMethodDefaults>;
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

  health(): Promise<{ status?: string; accountRegistrationConfigured?: boolean }> {
    return this.request('GET', '/health');
  }

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

  account(accountId: string): Promise<ManagedAccountSummary> {
    return this.request('GET', `/v1/accounts/${encodeURIComponent(accountId)}`);
  }

  async syncAccount(accountId: string): Promise<ManagedAccountSummary> {
    const operation = toOperation(await this.request<RawOperation>(
      'POST', `/v1/accounts/${encodeURIComponent(accountId)}/sync`, {}
    ));
    const deadline = Date.now() + 5 * 60_000;
    let current = operation;
    while (!['succeeded', 'failed', 'interrupted'].includes(current.status)) {
      if (Date.now() >= deadline) throw new AccountManagerError(504, 'GAM 账号同步超时');
      await wait(1_000);
      current = await this.operation(operation.id);
    }
    if (current.status !== 'succeeded') {
      throw new AccountManagerError(502, current.errorMessage || `GAM 账号同步失败：${current.status}`);
    }
    return this.account(accountId);
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

  configureAccountProxy(accountId: string, input: ResidentialProxyConfig): Promise<ResidentialProxyConfig> {
    return this.request('PUT', `/v1/accounts/${encodeURIComponent(accountId)}/proxy`, input);
  }

  session(accountId: string): Promise<ChatGptSessionInput> {
    return this.request('GET', `/v1/accounts/${encodeURIComponent(accountId)}/session`);
  }

  async changePersonalSubscription(accountId: string, input: ChangePersonalSubscriptionRequest & { requestTag?: string }) {
    return toOperation(await this.request(
      'POST', `/v1/accounts/${encodeURIComponent(accountId)}/operations/change-personal-subscription`, input
    ));
  }

  async cancelPersonalSubscriptionRenewal(accountId: string, input: { requestTag?: string } = {}) {
    return toOperation(await this.request(
      'POST', `/v1/accounts/${encodeURIComponent(accountId)}/operations/cancel-personal-subscription-renewal`, input
    ));
  }

  async openBusinessSubscription(accountId: string, input: OpenBusinessSubscriptionRequest & { requestTag?: string }) {
    return toOperation(await this.request(
      'POST', `/v1/accounts/${encodeURIComponent(accountId)}/operations/open-business-subscription`, input
    ));
  }

  async addPersonalPaymentMethod(accountId: string, input: AddPersonalPaymentMethodRequest & { requestTag?: string }) {
    return toOperation(await this.request(
      'POST', `/v1/accounts/${encodeURIComponent(accountId)}/operations/add-personal-payment-method`, input
    ));
  }

  personalPaymentMethodDefaults(accountId: string): Promise<PersonalPaymentMethodDefaults> {
    return this.request('GET', `/v1/accounts/${encodeURIComponent(accountId)}/personal-payment-method-defaults`);
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

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
