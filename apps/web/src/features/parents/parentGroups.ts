import type { AccountView } from '@team-manager/shared';
import {
  ALL_LOCAL_GROUP,
  ALL_LOCAL_GROUP_LABEL,
  countLocalGroups,
  filterByLocalGroup,
  localGroupName,
  resolveLocalGroup,
  type LocalGroupCount
} from '../../components/recordGroups.js';

export const ALL_PARENT_GROUP = ALL_LOCAL_GROUP;
export const ALL_PARENT_GROUP_LABEL = ALL_LOCAL_GROUP_LABEL;

export type ParentGroupCount = LocalGroupCount;

export function parentGroupName(account: AccountView): string {
  return localGroupName(account);
}

export function countParentGroups(accounts: AccountView[]): ParentGroupCount[] {
  return countLocalGroups(accounts);
}

export function resolveParentGroup(requestedGroup: string, groups: ParentGroupCount[]): string {
  return resolveLocalGroup(requestedGroup, groups);
}

export function filterParentsByGroup(accounts: AccountView[], activeGroup: string): AccountView[] {
  return filterByLocalGroup(accounts, activeGroup);
}
