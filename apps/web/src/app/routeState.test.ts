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
      new URLSearchParams('group=A&tab=invites&modal=remove-member&target=user-1')
    );

    expect(state).toEqual({
      group: 'A',
      tab: 'invites',
      modal: 'remove-member',
      target: 'user-1'
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

  test('parses subaccount credential tab modal target and credential workspace', () => {
    const state = parseSubaccountSearchState(
      new URLSearchParams('tab=credential&modal=delete-codex-credential&target=acct-1&credential=acct-2')
    );

    expect(state).toEqual({
      tab: 'credential',
      modal: 'delete-codex-credential',
      target: 'acct-1',
      credential: 'acct-2'
    });
  });

  test('updates a single search value without dropping unrelated params', () => {
    const params = setSearchValue(new URLSearchParams('group=A&tab=members'), 'tab', 'settings');

    expect(params.toString()).toBe('group=A&tab=settings');
  });

  test('sets and clears modal state while preserving route params', () => {
    const opened = setModalState(new URLSearchParams('group=A&tab=members'), 'invite-member', 'team-1');

    expect(opened.toString()).toBe('group=A&tab=members&modal=invite-member&target=team-1');
    expect(clearModalState(opened).toString()).toBe('group=A&tab=members');
  });
});
