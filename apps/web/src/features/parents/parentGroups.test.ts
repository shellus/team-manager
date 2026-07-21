import { describe, expect, test } from 'vitest';
import type { AccountView } from '@team-manager/shared';
import {
  ALL_PARENT_GROUP,
  countParentGroups,
  filterParentsByGroup,
  resolveParentGroup
} from './parentGroups.js';

function account(id: string, groupName: string): AccountView {
  return {
    id,
    email: `${id}@example.com`,
    groupName,
    limitType: 'unknown',
    accountId: `workspace-${id}`,
    hasTeamSubscription: true,
    canManageWorkspace: true
  };
}

describe('parentGroups', () => {
  const accounts = [account('a', 'A'), account('b', 'B'), account('c', 'A')];

  test('defaults to all groups when no valid group is selected', () => {
    const groups = countParentGroups(accounts);

    expect(resolveParentGroup('', groups)).toBe(ALL_PARENT_GROUP);
    expect(resolveParentGroup('missing', groups)).toBe(ALL_PARENT_GROUP);
  });

  test('returns all accounts for the all group and filters specific groups only when selected', () => {
    expect(filterParentsByGroup(accounts, ALL_PARENT_GROUP).map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(filterParentsByGroup(accounts, 'A').map((item) => item.id)).toEqual(['a', 'c']);
  });
});
