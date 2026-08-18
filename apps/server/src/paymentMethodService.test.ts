import assert from 'node:assert/strict';
import test from 'node:test';
import type { Transport } from './transport.js';
import {
  HttpPaymentMethodBinder,
  parsePaymentMethod,
  parsePaymentMethods,
  type SensitiveStripeRequest,
  type SensitiveStripeTransport
} from './services/paymentMethodService.js';

const CARD = { number: '4242424242424242', expiryMonth: 12, expiryYear: 2030, cvc: '123' };

test('纯 HTTP 绑卡只把 PAN/CVC 交给无追踪 Stripe Transport', async () => {
  const chatGptRequests: Array<{ path: string; body?: string }> = [];
  const stripeRequests: SensitiveStripeRequest[] = [];
  const targetAccountId = 'workspace-account';
  const accessToken = jwt({
    'https://api.openai.com/auth': { chatgpt_account_id: targetAccountId }
  });
  const chatGptTransport: Transport = {
    fetch: async (request) => {
      chatGptRequests.push({ path: request.path, body: request.body });
      if (request.path.startsWith('/api/auth/session?')) {
        return { status: 200, body: JSON.stringify({ accessToken }) };
      }
      if (request.path === '/backend-api/payments/payment_method') {
        return { status: 200, body: JSON.stringify({ client_secret: 'seti_example_secret_value' }) };
      }
      if (request.path.startsWith('/backend-api/payments/payment_methods?')) {
        return { status: 200, body: JSON.stringify({
          default_payment_method_id: 'pm_default',
          payment_methods: [{ id: 'pm_default', type: 'card', card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 } }]
        }) };
      }
      throw new Error(`unexpected ChatGPT request: ${request.path}`);
    }
  };
  const stripeTransport: SensitiveStripeTransport = {
    fetch: async (request) => {
      stripeRequests.push(request);
      return request.method === 'GET'
        ? { status: 200, body: JSON.stringify({ id: 'seti_example' }) }
        : { status: 200, body: JSON.stringify({ id: 'seti_example', status: 'succeeded' }) };
    }
  };
  const binder = new HttpPaymentMethodBinder(chatGptTransport, stripeTransport, {
    stripePublishableKeys: ['pk_test_example'],
    stripePaymentUserAgent: 'stripe.js/test'
  }, async () => undefined);

  const result = await binder.add({
    sessionToken: 'session-token', targetAccountId, proxy: 'http://proxy.example:8080',
    paymentMethod: { holderName: 'Taylor Anderson', postalCode: '97210', card: CARD }
  });

  assert.equal(result.paymentMethods[0]?.last4, '4242');
  assert.equal(chatGptRequests.some((request) => request.body?.includes(CARD.number)), false);
  assert.equal(chatGptRequests.some((request) => request.body?.includes(CARD.cvc)), false);
  const confirm = stripeRequests.find((request) => request.method === 'POST');
  assert.ok(confirm?.body?.includes(encodeURIComponent(CARD.number)));
  assert.ok(confirm?.body?.includes('payment_method_data%5Bcard%5D%5Bcvc%5D=123'));
});

test('Stripe requires_action 作为同步错误返回，不创建可恢复任务', async () => {
  const targetAccountId = 'personal-account';
  const transport: Transport = { fetch: async (request) => request.path.startsWith('/api/auth/session?')
    ? { status: 200, body: JSON.stringify({ accessToken: jwt({ 'https://api.openai.com/auth': { chatgpt_account_id: targetAccountId } }) }) }
    : { status: 200, body: JSON.stringify({ client_secret: 'seti_example_secret_value' }) } };
  const stripe: SensitiveStripeTransport = { fetch: async (request) => request.method === 'GET'
    ? { status: 200, body: '{}' }
    : { status: 200, body: JSON.stringify({ status: 'requires_action' }) } };
  const binder = new HttpPaymentMethodBinder(transport, stripe, {
    stripePublishableKeys: ['pk_test_example'], stripePaymentUserAgent: 'stripe.js/test'
  });
  await assert.rejects(
    () => binder.add({ sessionToken: 'session', targetAccountId, proxy: 'http://proxy.example:8080', paymentMethod: { holderName: 'Taylor Anderson', postalCode: '97210', card: CARD } }),
    /3DS/
  );
});

test('设置默认卡和移除卡使用 ChatGPT HTTP 接口并复读最新支付方式', async () => {
  const targetAccountId = 'personal-account';
  const requests: Array<{ method: string; path: string; body?: string; headers: Record<string, string> }> = [];
  let paymentMethods = [
    { id: 'pm_first', type: 'card', card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 } },
    { id: 'pm_second', type: 'card', card: { brand: 'mastercard', last4: '4444', exp_month: 11, exp_year: 2031 } }
  ];
  let defaultPaymentMethodId = 'pm_first';
  const transport: Transport = {
    fetch: async (request) => {
      requests.push({ method: request.method, path: request.path, body: request.body, headers: request.headers });
      if (request.path.startsWith('/api/auth/session?')) {
        return { status: 200, body: JSON.stringify({
          accessToken: jwt({ 'https://api.openai.com/auth': { chatgpt_account_id: targetAccountId } })
        }) };
      }
      if (request.path === '/backend-api/payments/payment_method/default') {
        const body = JSON.parse(request.body ?? '{}') as Record<string, string>;
        assert.deepEqual(body, { account_id: targetAccountId, payment_method_id: 'pm_second' });
        defaultPaymentMethodId = body.payment_method_id!;
        return { status: 200, body: JSON.stringify({ success: true }) };
      }
      if (request.method === 'DELETE' && request.path.startsWith('/backend-api/payments/payment_method/pm_first?')) {
        paymentMethods = paymentMethods.filter((item) => item.id !== 'pm_first');
        return { status: 200, body: JSON.stringify({ success: true }) };
      }
      if (request.path.startsWith('/backend-api/payments/payment_methods?')) {
        return { status: 200, body: JSON.stringify({
          default_payment_method_id: defaultPaymentMethodId,
          payment_methods: paymentMethods
        }) };
      }
      throw new Error(`unexpected request: ${request.method} ${request.path}`);
    }
  };
  const binder = new HttpPaymentMethodBinder(transport, { fetch: async () => {
    throw new Error('设置默认卡和移除卡不应访问 Stripe');
  } }, { stripePublishableKeys: [], stripePaymentUserAgent: '' }, async () => undefined);
  const input = { sessionToken: 'session', targetAccountId, proxy: 'http://proxy.example:8080' };

  const defaulted = await binder.setDefault({ ...input, paymentMethodId: 'pm_second' });
  assert.equal(defaulted.paymentMethods.find((item) => item.id === 'pm_second')?.isDefault, true);
  const removed = await binder.remove({ ...input, paymentMethodId: 'pm_first' });
  assert.deepEqual(removed.paymentMethods.map((item) => item.id), ['pm_second']);

  const defaultRequest = requests.find((request) => request.path === '/backend-api/payments/payment_method/default');
  assert.equal(defaultRequest?.headers['x-openai-target-route'], '/backend-api/payments/payment_method/default');
  const removeRequest = requests.find((request) => request.method === 'DELETE');
  assert.equal(removeRequest?.headers['x-openai-target-route'], '/backend-api/payments/payment_method/{payment_method_id}');
  assert.equal(removeRequest?.path, `/backend-api/payments/payment_method/pm_first?account_id=${targetAccountId}`);
});

test('支付方式输入校验 Luhn 并解析默认卡摘要', () => {
  assert.equal(parsePaymentMethod({ holderName: ' Taylor Anderson ', postalCode: ' 97210 ', card: CARD }).holderName, 'Taylor Anderson');
  assert.throws(() => parsePaymentMethod({ holderName: 'Taylor Anderson', postalCode: '97210', card: { ...CARD, number: '4242424242424241' } }), /卡号格式无效/);
  assert.deepEqual(parsePaymentMethods({ default_payment_method_id: 'pm_1', payment_methods: [{ id: 'pm_1', card: { last4: '4242' } }] }), [
    { id: 'pm_1', type: 'card', last4: '4242', isDefault: true }
  ]);
});

function jwt(payload: Record<string, unknown>) {
  return `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
}
