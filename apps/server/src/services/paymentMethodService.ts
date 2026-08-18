import { randomBytes, randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import { fetch as undiciFetch, ProxyAgent } from 'undici';
import type {
  AddSubscriptionPaymentMethodRequest,
  PaymentMethodDefaults,
  PersonalPaymentMethodView,
  SubscriptionPaymentMethodBindingResult
} from '@team-manager/shared';
import type { AppConfig } from '../config.js';
import type { Database } from '../database/schema.js';
import { fetchChatGptWebAccessTokenFromSessionToken } from '../chatgptWebSession.js';
import { AccountOperationalRepository } from '../repositories/accountOperationalRepository.js';
import { ActivityLogRepository } from '../repositories/activityLogRepository.js';
import { SessionRepository } from '../repositories/sessionRepository.js';
import { WorkspaceRepository } from '../repositories/workspaceRepository.js';
import { ServiceError, asServiceError } from '../serviceError.js';
import type { HttpResponse, Transport } from '../transport.js';
import type { AccountManagerService } from './accountManagerService.js';
import type { PersonalSpaceService } from './personalSpaceService.js';
import type { WorkspaceOperationService } from './workspaceOperationService.js';

const CHATGPT_BASE_URL = 'https://chatgpt.com';
const STRIPE_BASE_URL = 'https://api.stripe.com';
const DEFAULT_BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
  + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';
const PAYMENT_METHOD_READ_DELAYS_MS = [0, 500, 1_000, 2_000] as const;

export interface PaymentMethodBinderInput {
  sessionToken: string;
  targetAccountId: string;
  proxy: string;
  paymentMethod: AddSubscriptionPaymentMethodRequest;
}

export interface PaymentMethodMutationInput {
  sessionToken: string;
  targetAccountId: string;
  proxy: string;
  paymentMethodId: string;
}

export interface PaymentMethodBinder {
  add(input: PaymentMethodBinderInput): Promise<SubscriptionPaymentMethodBindingResult>;
  setDefault(input: PaymentMethodMutationInput): Promise<SubscriptionPaymentMethodBindingResult>;
  remove(input: PaymentMethodMutationInput): Promise<SubscriptionPaymentMethodBindingResult>;
}

export interface SensitiveStripeRequest {
  method: 'GET' | 'POST';
  path: string;
  headers: Record<string, string>;
  body?: string;
  proxy: string;
}

export interface SensitiveStripeTransport {
  fetch(request: SensitiveStripeRequest): Promise<HttpResponse>;
}

/** Stripe 卡片请求不接入全局 fetch 和 HTTP trace，避免 PAN/CVC 落盘。 */
export class NoTraceStripeTransport implements SensitiveStripeTransport {
  async fetch(request: SensitiveStripeRequest): Promise<HttpResponse> {
    const dispatcher = new ProxyAgent(request.proxy);
    try {
      const response = await undiciFetch(new URL(request.path, STRIPE_BASE_URL), {
        method: request.method,
        headers: request.headers,
        ...(request.body === undefined ? {} : { body: request.body }),
        dispatcher
      });
      return {
        status: response.status,
        body: await response.text(),
        headers: [...response.headers.entries()],
        url: response.url
      };
    } catch (error) {
      throw new ServiceError(502, `Stripe 代理 HTTP 请求失败: ${errorMessage(error)}`);
    } finally {
      await dispatcher.close().catch(() => undefined);
    }
  }
}

export class HttpPaymentMethodBinder implements PaymentMethodBinder {
  constructor(
    private readonly chatGptTransport: Transport,
    private readonly stripeTransport: SensitiveStripeTransport,
    private readonly config: Pick<AppConfig,
      'stripePublishableKeys' | 'stripePaymentUserAgent' | 'stripeWalletConfigId' | 'paymentHttpProxyHost'>,
    private readonly wait: (milliseconds: number) => Promise<void> = delay
  ) {}

  async add(input: PaymentMethodBinderInput): Promise<SubscriptionPaymentMethodBindingResult> {
    const paymentMethod = parsePaymentMethod(input.paymentMethod);
    const publishableKeys = this.config.stripePublishableKeys ?? [];
    const paymentUserAgent = this.config.stripePaymentUserAgent?.trim();
    if (!publishableKeys.length || !paymentUserAgent) {
      throw new ServiceError(503, 'Stripe HTTP 绑定配置不完整');
    }
    const proxy = overrideProxyHost(input.proxy, this.config.paymentHttpProxyHost);
    const { accessToken, cookie } = await this.targetContext(input);
    const clientSecret = await this.createSetupIntent(accessToken, input.targetAccountId, cookie, input.proxy);
    const publishableKey = await this.selectPublishableKey(clientSecret, publishableKeys, proxy);
    await this.confirmSetupIntent(clientSecret, publishableKey, paymentMethod, paymentUserAgent, proxy);
    const paymentMethods = await this.waitForPaymentMethod(
      accessToken,
      input.targetAccountId,
      cookie,
      input.proxy,
      paymentMethod.card.number.slice(-4)
    );
    return { targetAccountId: input.targetAccountId, paymentMethods };
  }

  async setDefault(input: PaymentMethodMutationInput): Promise<SubscriptionPaymentMethodBindingResult> {
    const paymentMethodId = validatePaymentMethodId(input.paymentMethodId);
    const context = await this.targetContext(input);
    const route = '/backend-api/payments/payment_method/default';
    const response = await this.chatGptTransport.fetch({
      method: 'POST', path: route, proxy: input.proxy,
      headers: chatGptHeaders(context.accessToken, input.targetAccountId, route, context.cookie, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ account_id: input.targetAccountId, payment_method_id: paymentMethodId })
    });
    assertMutationSucceeded(response, '设置默认支付方式');
    const paymentMethods = await this.waitForPaymentMethods(
      context.accessToken, input.targetAccountId, context.cookie, input.proxy,
      (items) => items.some((item) => item.id === paymentMethodId && item.isDefault),
      '上游未复读到目标默认支付方式'
    );
    return { targetAccountId: input.targetAccountId, paymentMethods };
  }

  async remove(input: PaymentMethodMutationInput): Promise<SubscriptionPaymentMethodBindingResult> {
    const paymentMethodId = validatePaymentMethodId(input.paymentMethodId);
    const context = await this.targetContext(input);
    const route = `/backend-api/payments/payment_method/${encodeURIComponent(paymentMethodId)}`;
    const response = await this.chatGptTransport.fetch({
      method: 'DELETE', path: `${route}?account_id=${encodeURIComponent(input.targetAccountId)}`, proxy: input.proxy,
      headers: chatGptHeaders(
        context.accessToken, input.targetAccountId, route, context.cookie, {},
        '/backend-api/payments/payment_method/{payment_method_id}'
      )
    });
    assertMutationSucceeded(response, '移除支付方式');
    const paymentMethods = await this.waitForPaymentMethods(
      context.accessToken, input.targetAccountId, context.cookie, input.proxy,
      (items) => items.every((item) => item.id !== paymentMethodId),
      '上游仍返回已移除的支付方式'
    );
    return { targetAccountId: input.targetAccountId, paymentMethods };
  }

  private async targetContext(input: Pick<PaymentMethodMutationInput, 'sessionToken' | 'targetAccountId' | 'proxy'>) {
    const accessToken = await fetchChatGptWebAccessTokenFromSessionToken(
      this.chatGptTransport, input.sessionToken, input.targetAccountId, input.proxy
    );
    return { accessToken, cookie: sessionCookieHeader(input.sessionToken, input.targetAccountId) };
  }

  private async createSetupIntent(accessToken: string, accountId: string, cookie: string, proxy: string) {
    const route = '/backend-api/payments/payment_method';
    const response = await this.chatGptTransport.fetch({
      method: 'POST', path: route, proxy,
      headers: chatGptHeaders(accessToken, accountId, route, cookie, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ account_id: accountId })
    });
    const body = responseJson(response, '创建 SetupIntent');
    if (response.status < 200 || response.status >= 300) {
      throw new ServiceError(upstreamStatus(response.status), `创建 SetupIntent 失败: HTTP ${response.status}`);
    }
    const clientSecret = stringValue(body.client_secret);
    if (!clientSecret?.includes('_secret_')) throw new ServiceError(502, 'SetupIntent 响应缺少 client_secret');
    return clientSecret;
  }

  private async selectPublishableKey(clientSecret: string, keys: string[], proxy: string) {
    const setupIntentId = clientSecret.split('_secret_', 1)[0]!;
    for (const key of keys) {
      if (!/^pk_(?:live|test)_/u.test(key)) continue;
      const query = new URLSearchParams({ client_secret: clientSecret, key });
      const response = await this.stripeTransport.fetch({
        method: 'GET', path: `/v1/setup_intents/${encodeURIComponent(setupIntentId)}?${query.toString()}`,
        proxy, headers: stripeHeaders()
      });
      if (response.status >= 200 && response.status < 300) return key;
    }
    throw new ServiceError(502, '没有配置可读取当前 SetupIntent 的 Stripe publishable key');
  }

  private async confirmSetupIntent(
    clientSecret: string,
    publishableKey: string,
    input: NormalizedPaymentMethod,
    paymentUserAgent: string,
    proxy: string
  ) {
    const setupIntentId = clientSecret.split('_secret_', 1)[0]!;
    const fields: Record<string, string> = {
      set_as_default_payment_method: 'true',
      'payment_method_data[type]': 'card',
      'payment_method_data[billing_details][name]': input.holderName,
      'payment_method_data[billing_details][address][postal_code]': input.postalCode,
      'payment_method_data[allow_redisplay]': 'always',
      'payment_method_data[card][number]': input.card.number,
      'payment_method_data[card][cvc]': input.card.cvc,
      'payment_method_data[card][exp_month]': String(input.card.expiryMonth).padStart(2, '0'),
      'payment_method_data[card][exp_year]': String(input.card.expiryYear).slice(-2),
      'payment_method_data[guid]': randomUUID(),
      'payment_method_data[muid]': randomUUID(),
      'payment_method_data[sid]': randomUUID(),
      'payment_method_data[pasted_fields]': 'number,exp,cvc',
      'payment_method_data[payment_user_agent]': paymentUserAgent,
      'payment_method_data[referrer]': CHATGPT_BASE_URL,
      'payment_method_data[time_on_page]': '30000',
      'payment_method_data[client_attribution_metadata][client_session_id]': randomUUID(),
      'payment_method_data[client_attribution_metadata][merchant_integration_source]': 'elements',
      'payment_method_data[client_attribution_metadata][merchant_integration_subtype]': 'card-element',
      'payment_method_data[client_attribution_metadata][merchant_integration_version]': '2017',
      expected_payment_method_type: 'card',
      use_stripe_sdk: 'true',
      key: publishableKey,
      client_secret: clientSecret
    };
    if (this.config.stripeWalletConfigId?.trim()) {
      fields['payment_method_data[client_attribution_metadata][wallet_config_id]'] = this.config.stripeWalletConfigId.trim();
    }
    const response = await this.stripeTransport.fetch({
      method: 'POST', path: `/v1/setup_intents/${encodeURIComponent(setupIntentId)}/confirm`, proxy,
      headers: stripeHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: new URLSearchParams(fields).toString()
    });
    const body = responseJson(response, '确认 SetupIntent');
    const stripeError = record(body.error);
    if (response.status < 200 || response.status >= 300 || stripeError) {
      const code = stringValue(stripeError?.code) ?? stringValue(stripeError?.decline_code) ?? `http_${response.status}`;
      const message = stringValue(stripeError?.message) ?? 'Stripe 确认失败';
      throw new ServiceError(422, `Stripe 确认失败（${code}）：${message}`);
    }
    const status = stringValue(body.status);
    if (status !== 'succeeded') {
      throw new ServiceError(409, status === 'requires_action'
        ? 'Stripe 要求 3DS 或其他交互验证，纯 HTTP 绑定不能继续'
        : `Stripe SetupIntent 未完成：${status ?? 'unknown'}`);
    }
  }

  private async waitForPaymentMethod(
    accessToken: string,
    accountId: string,
    cookie: string,
    proxy: string,
    expectedLast4: string
  ) {
    return this.waitForPaymentMethods(
      accessToken, accountId, cookie, proxy,
      (items) => items.some((item) => item.last4 === expectedLast4 && item.isDefault),
      'Stripe 已确认，但 ChatGPT 未复读到目标默认支付方式'
    );
  }

  private async waitForPaymentMethods(
    accessToken: string,
    accountId: string,
    cookie: string,
    proxy: string,
    complete: (items: PersonalPaymentMethodView[]) => boolean,
    failureMessage: string
  ) {
    let latest: PersonalPaymentMethodView[] = [];
    for (const milliseconds of PAYMENT_METHOD_READ_DELAYS_MS) {
      if (milliseconds) await this.wait(milliseconds);
      latest = await this.readPaymentMethods(accessToken, accountId, cookie, proxy);
      if (complete(latest)) return latest;
    }
    throw new ServiceError(502, failureMessage);
  }

  private async readPaymentMethods(accessToken: string, accountId: string, cookie: string, proxy: string) {
    const route = '/backend-api/payments/payment_methods';
    const response = await this.chatGptTransport.fetch({
      method: 'GET', path: `${route}?account_id=${encodeURIComponent(accountId)}`, proxy,
      headers: chatGptHeaders(accessToken, accountId, route, cookie)
    });
    if (response.status === 404) return [];
    const body = responseJson(response, '读取支付方式');
    if (response.status < 200 || response.status >= 300) {
      throw new ServiceError(upstreamStatus(response.status), `读取支付方式失败: HTTP ${response.status}`);
    }
    return parsePaymentMethods(body);
  }
}

export class SubscriptionPaymentMethodService {
  readonly #workspaces: WorkspaceRepository;
  readonly #activity: ActivityLogRepository;
  readonly #activeTargets = new Set<string>();

  constructor(
    private readonly db: Kysely<Database>,
    private readonly sessions: SessionRepository,
    private readonly operational: AccountOperationalRepository,
    private readonly binder: PaymentMethodBinder,
    private readonly accountManagement: AccountManagerService,
    private readonly personalSpaces: PersonalSpaceService,
    private readonly workspaceOperations: WorkspaceOperationService,
    private readonly config: Pick<AppConfig, 'paymentBillingPostalCode' | 'paymentBillingRegion'>
  ) {
    this.#workspaces = new WorkspaceRepository(db);
    this.#activity = new ActivityLogRepository(db);
  }

  async defaults(accountId: string): Promise<PaymentMethodDefaults> {
    const account = await this.db.selectFrom('accounts').select('id').where('id', '=', accountId).executeTakeFirst();
    if (!account) throw new ServiceError(404, '账号不存在');
    return {
      holderName: randomHolderName(),
      postalCode: this.config.paymentBillingPostalCode?.trim() || '97210',
      region: this.config.paymentBillingRegion?.trim() || 'US-OR'
    };
  }

  async addPersonal(accountId: string, input: AddSubscriptionPaymentMethodRequest) {
    const { targetAccountId } = await this.personalTarget(accountId);
    const result = await this.bind(accountId, targetAccountId, input);
    await this.personalSpaces.refresh(accountId, ['billing']);
    await this.logSuccess(accountId, null, 'personal', input, result);
    return result;
  }

  async addWorkspace(accountId: string, workspaceId: string, input: AddSubscriptionPaymentMethodRequest) {
    const workspace = await this.workspaceTarget(accountId, workspaceId);
    const result = await this.bind(accountId, workspace.external_id, input);
    await this.workspaceOperations.refreshBilling(workspace.id, accountId);
    await this.logSuccess(accountId, workspace.id, 'workspace', input, result);
    return result;
  }

  async setPersonalDefault(accountId: string, paymentMethodId: string) {
    const { targetAccountId } = await this.personalTarget(accountId);
    const result = await this.mutate(accountId, targetAccountId, paymentMethodId, 'default');
    await this.personalSpaces.refresh(accountId, ['billing']);
    await this.logMutation(accountId, null, 'personal', 'default', paymentMethodId, result.targetAccountId);
    return result;
  }

  async removePersonal(accountId: string, paymentMethodId: string) {
    const { targetAccountId } = await this.personalTarget(accountId);
    const result = await this.mutate(accountId, targetAccountId, paymentMethodId, 'remove');
    await this.personalSpaces.refresh(accountId, ['billing']);
    await this.logMutation(accountId, null, 'personal', 'remove', paymentMethodId, result.targetAccountId);
    return result;
  }

  async setWorkspaceDefault(accountId: string, workspaceId: string, paymentMethodId: string) {
    const workspace = await this.workspaceTarget(accountId, workspaceId);
    const result = await this.mutate(accountId, workspace.external_id, paymentMethodId, 'default');
    await this.workspaceOperations.refreshBilling(workspace.id, accountId);
    await this.logMutation(accountId, workspace.id, 'workspace', 'default', paymentMethodId, result.targetAccountId);
    return result;
  }

  async removeWorkspace(accountId: string, workspaceId: string, paymentMethodId: string) {
    const workspace = await this.workspaceTarget(accountId, workspaceId);
    const result = await this.mutate(accountId, workspace.external_id, paymentMethodId, 'remove');
    await this.workspaceOperations.refreshBilling(workspace.id, accountId);
    await this.logMutation(accountId, workspace.id, 'workspace', 'remove', paymentMethodId, result.targetAccountId);
    return result;
  }

  private async personalTarget(accountId: string) {
    const personal = await this.db.selectFrom('personal_spaces').select(['id', 'remote_account_id'])
      .where('account_id', '=', accountId).executeTakeFirst();
    if (!personal) throw new ServiceError(404, '账号不存在');
    const session = await this.requireSession(accountId);
    const targetAccountId = personal.remote_account_id ?? session.account?.id?.trim();
    if (!targetAccountId) throw new ServiceError(409, '个人空间缺少远端 Account ID');
    return { personalSpaceId: personal.id, targetAccountId };
  }

  private async workspaceTarget(accountId: string, workspaceId: string) {
    await this.#workspaces.requireManageableBy(workspaceId, accountId);
    const workspace = await this.#workspaces.findById(workspaceId);
    if (!workspace) throw new ServiceError(404, 'Workspace 不存在');
    return workspace;
  }

  private async mutate(
    accountId: string,
    targetAccountId: string,
    paymentMethodId: string,
    action: 'default' | 'remove'
  ) {
    return this.withTarget(accountId, targetAccountId, async (sessionToken, proxy) => (
      action === 'default'
        ? this.binder.setDefault({ sessionToken, targetAccountId, proxy, paymentMethodId })
        : this.binder.remove({ sessionToken, targetAccountId, proxy, paymentMethodId })
    ));
  }

  private async bind(accountId: string, targetAccountId: string, input: AddSubscriptionPaymentMethodRequest) {
    parsePaymentMethod(input);
    return this.withTarget(accountId, targetAccountId, (sessionToken, proxy) => (
      this.binder.add({ sessionToken, targetAccountId, proxy, paymentMethod: input })
    ));
  }

  private async withTarget<T>(
    accountId: string,
    targetAccountId: string,
    action: (sessionToken: string, proxy: string) => Promise<T>
  ): Promise<T> {
    const key = `${accountId}:${targetAccountId}`;
    if (this.#activeTargets.has(key)) throw new ServiceError(409, '该订阅目标已有支付方式写入请求正在进行');
    this.#activeTargets.add(key);
    try {
      const session = await this.requireSession(accountId);
      const proxy = await this.operational.proxy(accountId)
        ?? await this.accountManagement.ensureHttpProxy(accountId);
      if (!proxy) throw new ServiceError(409, '账号没有可用的 HTTP 代理');
      return await action(session.sessionToken!, proxy);
    } catch (error) {
      throw asServiceError(error);
    } finally {
      this.#activeTargets.delete(key);
    }
  }

  private async requireSession(accountId: string) {
    const session = await this.sessions.currentSession(accountId) as {
      sessionToken?: string;
      account?: { id?: string };
    } | undefined;
    if (!session?.sessionToken?.trim()) throw new ServiceError(409, '账号 Session 缺少 sessionToken');
    return session;
  }

  private async logSuccess(
    accountId: string,
    workspaceId: string | null,
    target: 'personal' | 'workspace',
    input: AddSubscriptionPaymentMethodRequest,
    result: SubscriptionPaymentMethodBindingResult
  ) {
    await this.#activity.log({
      accountId,
      workspaceId,
      kind: 'subscription_payment_method_added',
      payload: {
        target,
        targetAccountId: result.targetAccountId,
        cardLast4: input.card.number.replaceAll(' ', '').slice(-4)
      }
    });
  }

  private async logMutation(
    accountId: string,
    workspaceId: string | null,
    target: 'personal' | 'workspace',
    action: 'default' | 'remove',
    paymentMethodId: string,
    targetAccountId: string
  ) {
    await this.#activity.log({
      accountId,
      workspaceId,
      kind: action === 'default' ? 'subscription_payment_method_defaulted' : 'subscription_payment_method_removed',
      payload: { target, targetAccountId, paymentMethodId }
    });
  }
}

interface NormalizedPaymentMethod {
  holderName: string;
  postalCode: string;
  card: { number: string; expiryMonth: number; expiryYear: number; cvc: string };
}

export function parsePaymentMethod(input: AddSubscriptionPaymentMethodRequest): NormalizedPaymentMethod {
  const holderName = String(input?.holderName ?? '').trim();
  const postalCode = String(input?.postalCode ?? '').trim();
  const number = String(input?.card?.number ?? '').replace(/\s+/gu, '');
  const cvc = String(input?.card?.cvc ?? '');
  const expiryMonth = Number(input?.card?.expiryMonth);
  const expiryYear = Number(input?.card?.expiryYear);
  if (!holderName || holderName.length > 200) throw new ServiceError(400, '持卡人姓名无效');
  if (!postalCode || postalCode.length > 32) throw new ServiceError(400, '账单邮编无效');
  if (!/^\d{12,19}$/u.test(number) || !luhn(number)) throw new ServiceError(400, '卡号格式无效');
  if (!Number.isInteger(expiryMonth) || expiryMonth < 1 || expiryMonth > 12) throw new ServiceError(400, '卡片有效月份无效');
  if (!Number.isInteger(expiryYear) || expiryYear < new Date().getUTCFullYear() || expiryYear > 2100) {
    throw new ServiceError(400, '卡片有效年份无效');
  }
  if (!/^\d{3,4}$/u.test(cvc)) throw new ServiceError(400, 'CVC 格式无效');
  return { holderName, postalCode, card: { number, expiryMonth, expiryYear, cvc } };
}

export function parsePaymentMethods(raw: unknown): PersonalPaymentMethodView[] {
  const value = record(raw) ?? {};
  const defaultId = stringValue(value.default_payment_method_id ?? value.default_payment_method);
  const items = Array.isArray(value.payment_methods) ? value.payment_methods : Array.isArray(raw) ? raw : [];
  return items.flatMap((item) => {
    const payment = record(item); if (!payment) return [];
    const card = record(payment.card) ?? payment;
    const id = stringValue(payment.id); const last4 = stringValue(card.last4);
    if (!id || !last4) return [];
    return [{
      id,
      type: stringValue(payment.type) ?? 'card',
      ...(stringValue(card.brand) ? { brand: stringValue(card.brand) } : {}),
      last4,
      ...(Number.isInteger(Number(card.exp_month)) ? { expMonth: Number(card.exp_month) } : {}),
      ...(Number.isInteger(Number(card.exp_year)) ? { expYear: Number(card.exp_year) } : {}),
      isDefault: payment.is_default === true || id === defaultId
    }];
  });
}

function chatGptHeaders(
  accessToken: string,
  accountId: string,
  route: string,
  cookie: string,
  extra: Record<string, string> = {},
  targetRoute = route
) {
  return browserHeaders({
    Accept: 'application/json', Cookie: cookie, Authorization: `Bearer ${accessToken}`,
    'ChatGPT-Account-ID': accountId, 'x-openai-target-path': route, 'x-openai-target-route': targetRoute, ...extra
  });
}

function stripeHeaders(extra: Record<string, string> = {}) {
  return browserHeaders({ Accept: 'application/json', Origin: 'https://js.stripe.com', Referer: 'https://js.stripe.com/', ...extra });
}

function browserHeaders(headers: Record<string, string>) {
  return { 'User-Agent': DEFAULT_BROWSER_USER_AGENT, ...headers };
}

function sessionCookieHeader(sessionToken: string, targetAccountId: string) {
  const chunks: string[] = [];
  for (let offset = 0; offset < sessionToken.length; offset += 3_800) chunks.push(sessionToken.slice(offset, offset + 3_800));
  const cookies = ['__Secure-next-auth.session-token', '__Secure-authjs.session-token'].flatMap((name) => (
    chunks.length === 1 ? [`${name}=${chunks[0]}`] : chunks.map((value, index) => `${name}.${index}=${value}`)
  ));
  cookies.push(`_account=${targetAccountId}`, '_account_residency_region=no_constraint');
  return cookies.join('; ');
}

function responseJson(response: Pick<HttpResponse, 'status' | 'body'>, action: string) {
  try {
    const value = JSON.parse(response.body);
    if (record(value)) return value as Record<string, unknown>;
  } catch {}
  throw new ServiceError(response.status >= 400 && response.status < 500 ? response.status : 502, `${action}返回非 JSON 响应: HTTP ${response.status}`);
}

function assertMutationSucceeded(response: Pick<HttpResponse, 'status' | 'body'>, action: string) {
  const body = responseJson(response, action);
  if (response.status < 200 || response.status >= 300 || body.success === false) {
    throw new ServiceError(upstreamStatus(response.status), `${action}失败: HTTP ${response.status}`);
  }
}

function validatePaymentMethodId(value: string) {
  const paymentMethodId = String(value ?? '').trim();
  if (!/^[A-Za-z0-9_-]{3,255}$/u.test(paymentMethodId)) throw new ServiceError(400, '支付方式 ID 无效');
  return paymentMethodId;
}

function overrideProxyHost(proxy: string, hostOverride?: string) {
  if (!hostOverride?.trim()) return proxy;
  const url = new URL(proxy); url.hostname = hostOverride.trim(); return url.toString();
}

function randomHolderName() {
  const firstNames = ['Alex', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Avery', 'Quinn'];
  const lastNames = ['Miller', 'Wilson', 'Anderson', 'Thomas', 'Jackson', 'Martin', 'Lee', 'Clark'];
  const bytes = randomBytes(2);
  return `${firstNames[bytes[0]! % firstNames.length]} ${lastNames[bytes[1]! % lastNames.length]}`;
}

function luhn(number: string) {
  let sum = 0; let double = false;
  for (let index = number.length - 1; index >= 0; index -= 1) {
    let digit = Number(number[index]); if (double) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit; double = !double;
  }
  return sum % 10 === 0;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function stringValue(value: unknown) { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function upstreamStatus(status: number) { return status >= 400 && status < 500 ? status : 502; }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
function delay(milliseconds: number) { return new Promise<void>((resolve) => setTimeout(resolve, milliseconds)); }
