import type {
  Pro5xRenewalCancellationResult,
  Pro5xSubscriptionView
} from '@team-manager/shared';
import {
  ChatGptApi,
  ChatGptApiError,
  type ChatGptPro5xSubscriptionResponse
} from './chatgptApi.js';

export class Pro5xSubscriptionError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'Pro5xSubscriptionError';
  }
}

export async function readPro5xSubscription(
  api: ChatGptApi
): Promise<Pro5xSubscriptionView | null> {
  try {
    return parsePro5xSubscription(await api.getPro5xSubscription());
  } catch (error) {
    if (error instanceof ChatGptApiError && error.status === 404) return null;
    throw error;
  }
}

export async function cancelPro5xRenewal(
  api: ChatGptApi
): Promise<Pro5xRenewalCancellationResult> {
  const initial = await readPro5xSubscription(api);
  if (!initial || !['pro', 'prolite'].includes(initial.planType.toLowerCase())) {
    throw new Pro5xSubscriptionError(409, '该账号当前没有可取消续订的 Pro 5x 订阅');
  }
  if (!initial.willRenew) return { idempotent: true, subscription: initial };

  await api.cancelPro5xRenewal();
  let subscription: Pro5xSubscriptionView | null = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (attempt > 0) await delay(500);
    subscription = await readPro5xSubscription(api);
    if (subscription && !subscription.willRenew) {
      return { idempotent: false, subscription };
    }
  }
  throw new Pro5xSubscriptionError(
    502,
    `ChatGPT 已接受取消请求，但未确认 will_renew=false${subscription ? '' : '，且订阅状态无法读取'}`
  );
}

export function parsePro5xSubscription(
  raw: ChatGptPro5xSubscriptionResponse
): Pro5xSubscriptionView {
  const id = readString(raw.id);
  const planType = readString(raw.plan_type);
  if (!id || !planType || typeof raw.will_renew !== 'boolean') {
    throw new Pro5xSubscriptionError(502, 'ChatGPT 订阅接口缺少 id、plan_type 或 will_renew');
  }
  return {
    id,
    planType,
    ...(readString(raw.active_start) ? { activeStart: readString(raw.active_start)! } : {}),
    ...(readString(raw.active_until) ? { activeUntil: readString(raw.active_until)! } : {}),
    ...(readString(raw.billing_period) ? { billingPeriod: readString(raw.billing_period)! } : {}),
    ...(readString(raw.scheduled_billing_period)
      ? { scheduledBillingPeriod: readString(raw.scheduled_billing_period)! }
      : {}),
    willRenew: raw.will_renew,
    ...(readString(raw.cancellation_outcome)
      ? { cancellationOutcome: readString(raw.cancellation_outcome)! }
      : {}),
    ...(readString(raw.billing_currency)
      ? { billingCurrency: readString(raw.billing_currency)! }
      : {}),
    isDelinquent: raw.is_delinquent === true
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
