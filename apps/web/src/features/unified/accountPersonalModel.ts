export const PERSONAL_SPACE_TAB_KEYS = ['subscription', 'billing', 'quota', 'settings'] as const;

export type PersonalSpaceTab = (typeof PERSONAL_SPACE_TAB_KEYS)[number];

export function resolvePersonalSpaceTab(requested?: string | null): PersonalSpaceTab {
  return PERSONAL_SPACE_TAB_KEYS.includes(requested as PersonalSpaceTab)
    ? requested as PersonalSpaceTab
    : 'subscription';
}

export function selectPersonalSpaceTabParams(params: URLSearchParams, tab: PersonalSpaceTab) {
  const next = new URLSearchParams(params);
  next.set('personalTab', tab);
  next.delete('modal');
  if (tab !== 'quota') next.delete('quotaPage');
  return next;
}
