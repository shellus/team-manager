export type ParentTab = 'members' | 'account-manager' | 'order-maintenance' | 'settings' | 'billing';

export type ParentModal =
  | ''
  | 'import-parent'
  | 'register-parent'
  | 'open-codex-space'
  | 'open-team-subscription'
  | 'open-pro-5x'
  | 'edit-parent-profile'
  | 'delete-parent'
  | 'invite-member';

export type SubaccountTab = 'teams' | 'account-manager' | 'settings' | 'pat' | 'logs';

export type SubaccountModal =
  | ''
  | 'import-session'
  | 'register-subaccount'
  | 'open-pro-5x'
  | 'edit-subaccount-profile'
  | 'delete-subaccount'
  | 'invite-to-team'
  | 'manual-codex-callback'
  | 'delete-pat-credential';

export interface ParentSearchState {
  group: string;
  tab: ParentTab;
  modal: ParentModal;
  target: string;
}

export interface SubaccountSearchState {
  tab: SubaccountTab;
  modal: SubaccountModal;
  target: string;
}

export const parentTabs = ['members', 'account-manager', 'order-maintenance', 'settings', 'billing'] as const satisfies readonly ParentTab[];
export const subaccountTabs = ['teams', 'account-manager', 'settings', 'pat', 'logs'] as const satisfies readonly SubaccountTab[];

const parentTabSet = new Set<ParentTab>(parentTabs);
const parentModalSet = new Set<ParentModal>([
  '',
  'import-parent',
  'register-parent',
  'open-codex-space',
  'open-team-subscription',
  'open-pro-5x',
  'edit-parent-profile',
  'delete-parent',
  'invite-member'
]);

const subaccountTabSet = new Set<SubaccountTab>(subaccountTabs);
const subaccountModalSet = new Set<SubaccountModal>([
  '',
  'import-session',
  'register-subaccount',
  'open-pro-5x',
  'edit-subaccount-profile',
  'delete-subaccount',
  'invite-to-team',
  'manual-codex-callback',
  'delete-pat-credential'
]);

function readParam(params: URLSearchParams, key: string): string {
  return params.get(key)?.trim() ?? '';
}

export function parseParentSearchState(params: URLSearchParams): ParentSearchState {
  const rawTab = readParam(params, 'tab');
  const normalizedTab = rawTab === 'seats' || rawTab === 'invites' ? 'members' : rawTab;
  const rawModal = readParam(params, 'modal');
  const modal = parentModalSet.has(rawModal as ParentModal) ? (rawModal as ParentModal) : '';

  return {
    group: readParam(params, 'group'),
    tab: parentTabSet.has(normalizedTab as ParentTab) ? (normalizedTab as ParentTab) : 'members',
    modal,
    target: modal ? readParam(params, 'target') : ''
  };
}

export function resolveParentTabForWorkspace(
  canManageWorkspace: boolean,
  requestedTab: ParentTab,
  hasLocalMemberRows = false
): ParentTab {
  return canManageWorkspace || (requestedTab === 'members' && hasLocalMemberRows)
    ? requestedTab
    : 'account-manager';
}

export function parseSubaccountSearchState(params: URLSearchParams): SubaccountSearchState {
  const rawTab = readParam(params, 'tab');
  const rawModal = readParam(params, 'modal');
  const modal = subaccountModalSet.has(rawModal as SubaccountModal) ? (rawModal as SubaccountModal) : '';

  return {
    tab: subaccountTabSet.has(rawTab as SubaccountTab) ? (rawTab as SubaccountTab) : 'teams',
    modal,
    target: modal ? readParam(params, 'target') : ''
  };
}

export function setSearchValue(params: URLSearchParams, key: string, value: string): URLSearchParams {
  const next = new URLSearchParams(params);
  if (value) next.set(key, value);
  else next.delete(key);
  return next;
}

export function setModalState(params: URLSearchParams, modal: string, target = ''): URLSearchParams {
  let next = setSearchValue(params, 'modal', modal);
  next = setSearchValue(next, 'target', target);
  return next;
}

export function clearModalState(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete('modal');
  next.delete('target');
  return next;
}

export function normalizeRegistrationRouteSearch(
  params: URLSearchParams,
  registrationExists: boolean
): URLSearchParams {
  const next = registrationExists ? new URLSearchParams(params) : clearModalState(params);
  next.set('tab', 'account-manager');
  return next;
}
