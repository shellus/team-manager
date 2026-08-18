export type NormalizedPersonalPlan = 'free' | 'go' | 'plus' | 'pro_5x' | 'pro_20x' | 'unknown';

const PERSONAL_PLAN_CODES = {
  go: 'chatgptgoplan',
  plus: 'chatgptplusplan',
  pro_5x: 'chatgptprolite',
  pro_20x: 'chatgptpro'
} as const;

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

export function personalPlanCode(plan: Exclude<NormalizedPersonalPlan, 'free' | 'unknown'>): string {
  return PERSONAL_PLAN_CODES[plan];
}

export function isVerifiedPersonalPlanUpgrade(
  current: NormalizedPersonalPlan,
  target: NormalizedPersonalPlan
): boolean {
  return current === 'plus' && (target === 'pro_5x' || target === 'pro_20x');
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
