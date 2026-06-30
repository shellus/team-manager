import type { AccountView } from '@team-manager/shared';

export const ALL_PARENT_GROUP = '';
export const ALL_PARENT_GROUP_LABEL = '所有';

export interface ParentGroupCount {
  name: string;
  count: number;
}

export function parentGroupName(account: AccountView): string {
  return account.groupName || '默认分组';
}

export function countParentGroups(accounts: AccountView[]): ParentGroupCount[] {
  const countByGroup = new Map<string, number>();
  for (const account of accounts) {
    const groupName = parentGroupName(account);
    countByGroup.set(groupName, (countByGroup.get(groupName) ?? 0) + 1);
  }
  return [...countByGroup.entries()].map(([name, count]) => ({ name, count }));
}

export function resolveParentGroup(requestedGroup: string, groups: ParentGroupCount[]): string {
  return groups.some((group) => group.name === requestedGroup) ? requestedGroup : ALL_PARENT_GROUP;
}

export function filterParentsByGroup(accounts: AccountView[], activeGroup: string): AccountView[] {
  if (activeGroup === ALL_PARENT_GROUP) return accounts;
  return accounts.filter((account) => parentGroupName(account) === activeGroup);
}
