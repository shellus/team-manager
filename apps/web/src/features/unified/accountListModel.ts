import type { UnifiedAccountSummaryView } from "@team-manager/shared";

export const SHOW_BANNED_PARAM = "showBanned";

type GroupedAccount = Pick<UnifiedAccountSummaryView, "group">;

export function accountListRequestQuery(
  params: URLSearchParams,
): URLSearchParams {
  const query = new URLSearchParams();
  for (const key of ["query", "primaryPlan"] as const) {
    const value = params.get(key);
    if (value) query.set(key, value);
  }
  for (const key of ["hasGamBinding", "hasRunningProfile"] as const) {
    if (params.get(key) === "true") query.set(key, "true");
  }
  if (!showsBannedAccounts(params)) query.set("isBanned", "false");
  return query;
}

export function showsBannedAccounts(params: URLSearchParams): boolean {
  return params.get(SHOW_BANNED_PARAM) === "true";
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
