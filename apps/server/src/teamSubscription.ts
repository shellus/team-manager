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
