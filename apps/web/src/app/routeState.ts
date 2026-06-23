export type ParentTab = 'members' | 'invites' | 'settings';

export type ParentModal =
  | ''
  | 'import-parent'
  | 'edit-parent-profile'
  | 'delete-parent'
  | 'invite-member'
  | 'remove-member'
  | 'revoke-invite'
  | 'rename-team'
  | 'billing-risk';

export type SubaccountTab = 'teams' | 'credential' | 'auth' | 'quota' | 'logs';

export type SubaccountModal =
  | ''
  | 'import-session'
  | 'import-credential'
  | 'register-subaccount'
  | 'edit-subaccount-profile'
  | 'delete-subaccount'
  | 'invite-to-team'
  | 'manual-codex-callback'
  | 'delete-codex-credential'
  | 'billing-risk';

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
  credential: string;
}

export const parentTabs = ['members', 'invites', 'settings'] as const satisfies readonly ParentTab[];
export const subaccountTabs = ['teams', 'credential', 'auth', 'quota', 'logs'] as const satisfies readonly SubaccountTab[];

const parentTabSet = new Set<ParentTab>(parentTabs);
const parentModalSet = new Set<ParentModal>([
  '',
  'import-parent',
  'edit-parent-profile',
  'delete-parent',
  'invite-member',
  'remove-member',
  'revoke-invite',
  'rename-team',
  'billing-risk'
]);

const subaccountTabSet = new Set<SubaccountTab>(subaccountTabs);
const subaccountModalSet = new Set<SubaccountModal>([
  '',
  'import-session',
  'import-credential',
  'register-subaccount',
  'edit-subaccount-profile',
  'delete-subaccount',
  'invite-to-team',
  'manual-codex-callback',
  'delete-codex-credential',
  'billing-risk'
]);

function readParam(params: URLSearchParams, key: string): string {
  return params.get(key)?.trim() ?? '';
}

export function parseParentSearchState(params: URLSearchParams): ParentSearchState {
  const rawTab = readParam(params, 'tab');
  const rawModal = readParam(params, 'modal');
  const modal = parentModalSet.has(rawModal as ParentModal) ? (rawModal as ParentModal) : '';

  return {
    group: readParam(params, 'group'),
    tab: parentTabSet.has(rawTab as ParentTab) ? (rawTab as ParentTab) : 'members',
    modal,
    target: modal ? readParam(params, 'target') : ''
  };
}

export function parseSubaccountSearchState(params: URLSearchParams): SubaccountSearchState {
  const rawTab = readParam(params, 'tab');
  const rawModal = readParam(params, 'modal');
  const modal = subaccountModalSet.has(rawModal as SubaccountModal) ? (rawModal as SubaccountModal) : '';

  return {
    tab: subaccountTabSet.has(rawTab as SubaccountTab) ? (rawTab as SubaccountTab) : 'teams',
    modal,
    target: modal ? readParam(params, 'target') : '',
    credential: readParam(params, 'credential')
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
