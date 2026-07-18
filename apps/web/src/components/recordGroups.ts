export const ALL_LOCAL_GROUP = '';
export const ALL_LOCAL_GROUP_LABEL = '所有';
export const DEFAULT_LOCAL_GROUP = '默认分组';

export interface LocalGroupCount {
  name: string;
  count: number;
}

export function localGroupName(record: { groupName?: string }): string {
  return record.groupName || DEFAULT_LOCAL_GROUP;
}

export function countLocalGroups<T extends { groupName?: string }>(records: T[]): LocalGroupCount[] {
  const countByGroup = new Map<string, number>();
  for (const record of records) {
    const groupName = localGroupName(record);
    countByGroup.set(groupName, (countByGroup.get(groupName) ?? 0) + 1);
  }
  return [...countByGroup.entries()].map(([name, count]) => ({ name, count }));
}

export function resolveLocalGroup(requestedGroup: string, groups: LocalGroupCount[]): string {
  return groups.some((group) => group.name === requestedGroup) ? requestedGroup : ALL_LOCAL_GROUP;
}

export function filterByLocalGroup<T extends { groupName?: string }>(records: T[], activeGroup: string): T[] {
  if (activeGroup === ALL_LOCAL_GROUP) return records;
  return records.filter((record) => localGroupName(record) === activeGroup);
}
