export type NormalizedPersonalPlan = 'free' | 'go' | 'plus' | 'pro_5x' | 'pro_20x' | 'unknown';

export interface PersonalPlanAccountObservation {
  accountId: string;
  planType?: string;
  structure?: string;
  canAccessWithSession?: boolean;
}

export interface ResolvedPersonalPlan {
  accountId?: string;
  rawPlanCode: string;
  normalizedPlan: NormalizedPersonalPlan;
}

export function normalizePersonalPlan(value?: string): NormalizedPersonalPlan {
  const key = value?.trim().toLowerCase() ?? '';
  if (['free', 'go', 'plus', 'pro_5x', 'pro_20x'].includes(key)) return key as NormalizedPersonalPlan;
  if (key.includes('prolite')) return 'pro_5x';
  if (key.includes('pro')) return 'pro_20x';
  if (key.includes('plus')) return 'plus';
  if (key.includes('go')) return 'go';
  return 'unknown';
}

export function resolvePersonalPlan(
  accounts: PersonalPlanAccountObservation[],
  hintedAccountId: string,
  fallbackPlanType?: string
): ResolvedPersonalPlan {
  const accessible = accounts.filter((item) => item.canAccessWithSession !== false);
  const personal = accessible.filter((item) => item.structure === 'personal');
  const observed = personal.find((item) => item.accountId === hintedAccountId)
    ?? (personal.length === 1 ? personal[0] : undefined)
    ?? accessible.find((item) => item.accountId === hintedAccountId && item.structure !== 'workspace');
  const rawPlanCode = observed?.planType?.trim() || fallbackPlanType?.trim() || 'unknown';
  return {
    ...(observed ? { accountId: observed.accountId } : {}),
    rawPlanCode,
    normalizedPlan: normalizePersonalPlan(rawPlanCode)
  };
}
