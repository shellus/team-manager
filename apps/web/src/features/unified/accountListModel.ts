import type { UnifiedAccountSummaryView } from "@team-manager/shared";

export type AccountListBooleanFilter = "true" | "false" | undefined;

export const ACCOUNT_LIST_FILTER_STORAGE_KEY =
  "team-manager.accounts.filters.v1";

type AccountFilterStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

type GroupedAccount = Pick<UnifiedAccountSummaryView, "group">;

export function accountListBooleanFilter(
  params: URLSearchParams,
  key: "hasGamBinding" | "hasRunningProfile" | "isBanned",
): AccountListBooleanFilter {
  const value = params.get(key);
  return value === "true" || value === "false" ? value : undefined;
}

export function accountListRequestQuery(
  params: URLSearchParams,
): URLSearchParams {
  const query = new URLSearchParams();
  for (const key of ["query", "primaryPlan"] as const) {
    const value = params.get(key);
    if (value) query.set(key, value);
  }
  for (const key of ["hasGamBinding", "hasRunningProfile", "isBanned"] as const) {
    const value = accountListBooleanFilter(params, key);
    if (value) query.set(key, value);
  }
  return query;
}

export function accountListPersistedFilterQuery(
  params: URLSearchParams,
): URLSearchParams {
  const query = accountListRequestQuery(params);
  const groupId = params.get("groupId");
  if (groupId) query.set("groupId", groupId);
  return query;
}

export function restorePersistedAccountListFilters(
  params: URLSearchParams,
  storage: Pick<AccountFilterStorage, "getItem"> | undefined,
): URLSearchParams | undefined {
  if (accountListPersistedFilterQuery(params).size > 0) return undefined;
  try {
    const raw = storage?.getItem(ACCOUNT_LIST_FILTER_STORAGE_KEY);
    if (!raw) return undefined;
    const saved = accountListPersistedFilterQuery(new URLSearchParams(raw));
    if (saved.size === 0) return undefined;
    const restored = new URLSearchParams(params);
    saved.forEach((value, key) => restored.set(key, value));
    return restored;
  } catch {
    return undefined;
  }
}

export function persistAccountListFilters(
  params: URLSearchParams,
  storage: Pick<AccountFilterStorage, "setItem" | "removeItem"> | undefined,
): void {
  try {
    const filters = accountListPersistedFilterQuery(params);
    if (filters.size > 0) {
      storage?.setItem(ACCOUNT_LIST_FILTER_STORAGE_KEY, filters.toString());
    } else {
      storage?.removeItem(ACCOUNT_LIST_FILTER_STORAGE_KEY);
    }
  } catch {
    // localStorage 不可用时继续使用 URL 状态。
  }
}

export function countAccountsByGroup(
  accounts: readonly GroupedAccount[],
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const account of accounts) {
    counts.set(account.group.id, (counts.get(account.group.id) ?? 0) + 1);
  }
  return counts;
}

export function selectAccountsByGroup<T extends GroupedAccount>(
  accounts: readonly T[],
  groupId?: string,
): T[] {
  return groupId
    ? accounts.filter((account) => account.group.id === groupId)
    : [...accounts];
}

export function accountSelectionState(
  selectedAccountIds: readonly string[],
  filteredAccountIds: readonly string[],
): { allSelected: boolean; partiallySelected: boolean } {
  const selected = new Set(selectedAccountIds);
  const selectedCount = filteredAccountIds.reduce(
    (count, id) => count + Number(selected.has(id)),
    0,
  );
  return {
    allSelected:
      filteredAccountIds.length > 0 && selectedCount === filteredAccountIds.length,
    partiallySelected:
      selectedCount > 0 && selectedCount < filteredAccountIds.length,
  };
}
