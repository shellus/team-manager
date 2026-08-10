function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && Boolean(value.trim());
}

function hasSubscriptionDetails(value: unknown): boolean {
  return isRecord(value) && nonEmptyString(value.subscription);
}

/**
 * Stripe upcoming invoice 是当前 Team 月付订阅的稳定信号。
 * accounts/check 的 plan_type 在既有 usage-based Workspace 升级后仍可能保持原值。
 */
export function upcomingInvoiceHasTeamSubscription(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (nonEmptyString(value.subscription)) return true;
  if (hasSubscriptionDetails(value.subscription_details)) return true;

  const parent = isRecord(value.parent) ? value.parent : undefined;
  if (hasSubscriptionDetails(parent?.subscription_details)) return true;

  const lines = isRecord(value.lines) && Array.isArray(value.lines.data) ? value.lines.data : [];
  return lines.some((line) => {
    if (!isRecord(line)) return false;
    if (line.type === 'subscription' || nonEmptyString(line.subscription)) return true;
    const lineParent = isRecord(line.parent) ? line.parent : undefined;
    return hasSubscriptionDetails(lineParent?.subscription_item_details);
  });
}

/** 将 Stripe 下一次预计扣款秒级时间戳转为母号续费时间。 */
export function upcomingInvoiceNextPaymentAt(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const seconds = value.next_payment_attempt;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return undefined;
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return undefined;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')}`;
}

export interface UpcomingInvoiceRenewalAmount {
  amount: number;
  currency: string;
}

/** 读取 Stripe upcoming invoice 的预计应付金额和账单原币。 */
export function upcomingInvoiceRenewalAmount(value: unknown): UpcomingInvoiceRenewalAmount | undefined {
  if (!isRecord(value)) return undefined;
  const amount = typeof value.amount_due === 'number' && Number.isFinite(value.amount_due)
    ? value.amount_due
    : value.total;
  const currency = typeof value.currency === 'string' ? value.currency.trim().toUpperCase() : '';
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || !/^[A-Z]{3}$/.test(currency)) {
    return undefined;
  }
  return { amount, currency };
}
