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

export function resolvePreferredLocalGroup(
  requestedGroup: string | undefined,
  rememberedGroup: string | undefined,
  groups: LocalGroupCount[]
): string {
  if (requestedGroup === ALL_LOCAL_GROUP) return ALL_LOCAL_GROUP;
  if (requestedGroup && groups.some((group) => group.name === requestedGroup)) return requestedGroup;
  if (rememberedGroup === ALL_LOCAL_GROUP) return ALL_LOCAL_GROUP;
  if (rememberedGroup && groups.some((group) => group.name === rememberedGroup)) return rememberedGroup;
  return groups[0]?.name ?? ALL_LOCAL_GROUP;
}

export function readLocalGroupPreference(storageKey: string): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage.getItem(storageKey) ?? undefined;
  } catch {
    return undefined;
  }
}

export function rememberLocalGroupPreference(storageKey: string, group: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey, group);
  } catch {
    // 浏览器禁用本地存储时，URL 中的分组状态仍然可用。
  }
}

export function filterByLocalGroup<T extends { groupName?: string }>(records: T[], activeGroup: string): T[] {
  if (activeGroup === ALL_LOCAL_GROUP) return records;
  return records.filter((record) => localGroupName(record) === activeGroup);
}
