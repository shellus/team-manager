import { describe, expect, test } from 'vitest';
import {
  clearModalState,
  normalizeRegistrationRouteSearch,
  parseParentSearchState,
  parseSubaccountSearchState,
  resolveParentTabForWorkspace,
  setModalState,
  setSearchValue
} from './routeState.js';

describe('routeState', () => {
  test('parses parent group tab modal and target from search params', () => {
    const state = parseParentSearchState(
      new URLSearchParams('group=A&tab=invites&modal=invite-member&target=account-1')
    );

    expect(state).toEqual({
      group: 'A',
      tab: 'members',
      modal: 'invite-member',
      target: 'account-1'
    });
  });

  test('normalizes unsupported parent tab and modal values', () => {
    const state = parseParentSearchState(new URLSearchParams('tab=bad&modal=bad&target=user-1'));

    expect(state).toEqual({
      group: '',
      tab: 'members',
      modal: '',
      target: ''
    });
  });

  test('rejects an unsupported child tab while keeping only a current modal', () => {
    const state = parseSubaccountSearchState(
      new URLSearchParams('tab=unsupported&modal=delete-pat-credential&target=acct-1')
    );

    expect(state).toEqual({
      tab: 'teams',
      modal: 'delete-pat-credential',
      target: 'acct-1'
    });
  });

  test('persists the parent 0.52 modal and target in the route', () => {
    const state = parseParentSearchState(
      new URLSearchParams('tab=members&modal=open-codex-space&target=account-1')
    );

    expect(state.modal).toBe('open-codex-space');
    expect(state.target).toBe('account-1');
  });

  test('persists the parent two-seat Team modal and target in the route', () => {
    const state = parseParentSearchState(
      new URLSearchParams('tab=members&modal=open-team-subscription&target=account-1')
    );

    expect(state.modal).toBe('open-team-subscription');
    expect(state.target).toBe('account-1');
  });

  test('persists the parent Pro 5x modal and target in the route', () => {
    const state = parseParentSearchState(
      new URLSearchParams('tab=account-manager&modal=open-pro-5x&target=account-1')
    );

    expect(state.modal).toBe('open-pro-5x');
    expect(state.target).toBe('account-1');
  });

  test('persists the child Pro 5x modal and target in the route', () => {
    const state = parseSubaccountSearchState(
      new URLSearchParams('tab=account-manager&modal=open-pro-5x&target=child-1')
    );

    expect(state.modal).toBe('open-pro-5x');
    expect(state.target).toBe('child-1');
  });

  test('persists the child Codex OAuth callback modal and workspace target', () => {
    const state = parseSubaccountSearchState(
      new URLSearchParams('tab=pat&modal=manual-codex-callback&target=workspace-1')
    );

    expect(state.modal).toBe('manual-codex-callback');
    expect(state.target).toBe('workspace-1');
  });

  test('does not persist the child Team leave action as a blocking route modal', () => {
    const state = parseSubaccountSearchState(new URLSearchParams('tab=teams&modal=leave-team&target=workspace-1'));

    expect(state).toEqual({
      tab: 'teams',
      modal: '',
      target: ''
    });
  });

  test('does not keep removed parent row actions as route modals', () => {
    const state = parseParentSearchState(new URLSearchParams('tab=members&modal=remove-member&target=user-1'));

    expect(state).toEqual({
      group: '',
      tab: 'members',
      modal: '',
      target: ''
    });
  });

  test('updates a single search value without dropping unrelated params', () => {
    const params = setSearchValue(new URLSearchParams('group=A&tab=members'), 'tab', 'settings');

    expect(params.toString()).toBe('group=A&tab=settings');
  });

  test('accepts the parent billing tab from search params', () => {
    const state = parseParentSearchState(new URLSearchParams('group=A&tab=billing'));

    expect(state.tab).toBe('billing');
  });

  test('normalizes removed customer seat and invite tabs to the unified member tab', () => {
    expect(parseParentSearchState(new URLSearchParams('group=A&tab=seats')).tab).toBe('members');
    expect(parseParentSearchState(new URLSearchParams('group=A&tab=invites')).tab).toBe('members');
  });

  test('accepts the parent account manager tab from search params', () => {
    const state = parseParentSearchState(new URLSearchParams('group=A&tab=account-manager'));

    expect(state.tab).toBe('account-manager');
  });

  test('routes a parent without workspace capabilities to account management', () => {
    expect(resolveParentTabForWorkspace(false, 'members')).toBe('account-manager');
    expect(resolveParentTabForWorkspace(false, 'members', true)).toBe('members');
    expect(resolveParentTabForWorkspace(true, 'members')).toBe('members');
  });

  test('sets and clears modal state while preserving route params', () => {
    const opened = setModalState(new URLSearchParams('group=A&tab=members'), 'invite-member', 'team-1');

    expect(opened.toString()).toBe('group=A&tab=members&modal=invite-member&target=team-1');
    expect(clearModalState(opened).toString()).toBe('group=A&tab=members');
  });

  test('keeps an opened modal while normalizing an existing registration task route', () => {
    const params = new URLSearchParams('group=A&tab=members&modal=open-pro-5x&target=account-1');

    expect(normalizeRegistrationRouteSearch(params, true).toString()).toBe(
      'group=A&tab=account-manager&modal=open-pro-5x&target=account-1'
    );
  });

  test('clears modal state when a registration task route no longer exists', () => {
    const params = new URLSearchParams('group=A&modal=register-subaccount&target=account-1');

    expect(normalizeRegistrationRouteSearch(params, false).toString()).toBe('group=A&tab=account-manager');
  });
});
