import { describe, expect, it } from 'vitest';
import {
  clearTeamOrderPageModalState,
  parseTeamOrderPageModalState,
  setTeamOrderPageModalState
} from './teamOrderPageState.js';

describe('team order page modal state', () => {
  it('persists edit and remove actions without dropping table filters', () => {
    const base = new URLSearchParams('q=brandon&status=attention&expanded=account-1');
    const opened = setTeamOrderPageModalState(base, 'edit-maintenance', 'account-1');

    expect(parseTeamOrderPageModalState(opened)).toEqual({ modal: 'edit-maintenance', target: 'account-1' });
    expect(opened.get('q')).toBe('brandon');
    expect(opened.get('expanded')).toBe('account-1');

    const closed = clearTeamOrderPageModalState(opened);
    expect(parseTeamOrderPageModalState(closed)).toEqual({ modal: '', target: '' });
    expect(closed.get('status')).toBe('attention');
  });

  it('ignores unknown modal values and their targets', () => {
    expect(parseTeamOrderPageModalState(new URLSearchParams('modal=unknown&target=account-1')))
      .toEqual({ modal: '', target: '' });
  });
});
