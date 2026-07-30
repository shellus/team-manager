import { describe, expect, test } from 'vitest';
import type { AccountView, ParentRegistrationTaskView } from '@team-manager/shared';
import {
  ALL_PARENT_GROUP,
  countParentGroups,
  filterParentRegistrationTasksByGroup,
  filterParentsByGroup,
  parentRegistrationTaskGroupName,
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

  test('uses the registration request group when filtering parent tasks', () => {
    const task = (id: string, groupName: string): ParentRegistrationTaskView => ({
      registration: {
        id,
        type: 'register',
        status: 'running',
        phase: 'registration_running',
        message: '注册中',
        progress: 30,
        requestSummary: { clientReference: groupName },
        createdAt: 1,
        updatedAt: 1
      },
      stage: 'registering'
    });
    const tasks = [task('task-a', 'A'), task('task-b', 'B')];

    expect(parentRegistrationTaskGroupName(tasks[0])).toBe('A');
    expect(filterParentRegistrationTasksByGroup(tasks, 'B').map((item) => item.registration.id))
      .toEqual(['task-b']);
    expect(filterParentRegistrationTasksByGroup(tasks, ALL_PARENT_GROUP)).toEqual(tasks);
  });
});
