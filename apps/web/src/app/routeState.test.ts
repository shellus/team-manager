import { describe, expect, test } from 'vitest';
import {
  clearModalState,
  parseParentSearchState,
  parseSubaccountSearchState,
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
      tab: 'invites',
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

  test('maps the former credential tab to PAT and parses the PAT delete modal', () => {
    const state = parseSubaccountSearchState(
      new URLSearchParams('tab=credential&modal=delete-pat-credential&target=acct-1')
    );

    expect(state).toEqual({
      tab: 'pat',
      modal: 'delete-pat-credential',
      target: 'acct-1'
    });
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

  test('sets and clears modal state while preserving route params', () => {
    const opened = setModalState(new URLSearchParams('group=A&tab=members'), 'invite-member', 'team-1');

    expect(opened.toString()).toBe('group=A&tab=members&modal=invite-member&target=team-1');
    expect(clearModalState(opened).toString()).toBe('group=A&tab=members');
  });
});
