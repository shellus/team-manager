import type {
  PromotionContextTarget,
  PromotionLookupView,
  WorkspacePromotionMetadataView,
  WorkspacePromotionReasonView,
  WorkspacePromotionSubscriptionView
} from '@team-manager/shared';
import type {
  ChatGptPromotionEligibilityResponse,
  ChatGptPromotionMetadataResponse,
  ChatGptSubscriptionResponse
} from '../chatgptApi.js';

export function promotionLookupView(
  target: PromotionContextTarget,
  targetLabel: string,
  promoCode: string,
  eligibility: ChatGptPromotionEligibilityResponse,
  metadata?: ChatGptPromotionMetadataResponse,
  subscription?: ChatGptSubscriptionResponse
): PromotionLookupView {
  const rawMetadata = metadata?.metadata;
  const reason = metadata?.is_eligible === false
    ? metadata.ineligible_reason
    : eligibility.is_eligible === false
      ? eligibility.ineligible_reason
      : undefined;
  const normalizedReason = promotionReason(reason);
  return {
    promoCode,
    target,
    targetLabel,
    isEligible: eligibility.is_eligible === true && (metadata === undefined || metadata.is_eligible !== false),
    ...(normalizedReason ? { ineligibleReason: normalizedReason } : {}),
    ...(rawMetadata ? { metadata: promotionMetadata(rawMetadata) } : {}),
    ...(subscription ? { subscription: promotionSubscription(subscription) } : {}),
    ...(subscription ? { wouldEnableRenewal: subscription.will_renew !== true } : {})
  };
}

function promotionMetadata(value: NonNullable<ChatGptPromotionMetadataResponse['metadata']>): WorkspacePromotionMetadataView {
  return {
    planName: value.plan_name ?? '',
    ...(text(value.title) ? { title: text(value.title) } : {}),
    ...(text(value.summary) ? { summary: text(value.summary) } : {}),
    ...(finite(value.discount?.quantity_off) !== undefined ? { quantityOff: finite(value.discount?.quantity_off) } : {}),
    ...(finite(value.duration?.num_periods) !== undefined ? { durationPeriods: finite(value.duration?.num_periods) } : {}),
    ...(text(value.duration?.period) ? { durationPeriod: text(value.duration?.period) } : {}),
    ...(typeof value.no_auto_renewal_at_discount_end === 'boolean' ? { noAutoRenewalAtDiscountEnd: value.no_auto_renewal_at_discount_end } : {}),
    ...(text(value.promotion_type) ? { promotionType: text(value.promotion_type) } : {}),
    ...(text(value.price_period) ? { pricePeriod: text(value.price_period) } : {}),
    ...(text(value.processor) ? { processor: text(value.processor) } : {})
  };
}

function promotionReason(value: unknown): WorkspacePromotionReasonView | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const reason = value as Record<string, unknown>;
  const title = text(reason.title);
  const message = text(reason.message);
  const code = text(reason.code);
  return title || message || code ? { ...(title ? { title } : {}), ...(message ? { message } : {}), ...(code ? { code } : {}) } : undefined;
}

function promotionSubscription(value: ChatGptSubscriptionResponse): WorkspacePromotionSubscriptionView {
  return {
    ...(text(value.plan_type) ? { planType: text(value.plan_type) } : {}),
    ...(finite(value.seats_in_use) !== undefined ? { seatsInUse: finite(value.seats_in_use) } : {}),
    ...(finite(value.seats_entitled) !== undefined ? { seatsEntitled: finite(value.seats_entitled) } : {}),
    ...(text(value.active_until) ? { activeUntil: text(value.active_until) } : {}),
    ...(text(value.billing_period) ? { billingPeriod: text(value.billing_period) } : {}),
    ...(text(value.billing_currency) ? { billingCurrency: text(value.billing_currency) } : {}),
    ...(typeof value.will_renew === 'boolean' ? { willRenew: value.will_renew } : {}),
    ...(text(value.cancellation_outcome) ? { cancellationOutcome: text(value.cancellation_outcome) } : {})
  };
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
