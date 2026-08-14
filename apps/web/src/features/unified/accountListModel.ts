import type { UnifiedAccountSummaryView } from "@team-manager/shared";

export type AccountListBooleanFilter = "true" | "false" | undefined;

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
