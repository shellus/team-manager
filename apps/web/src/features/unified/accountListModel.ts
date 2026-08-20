import type { UnifiedAccountSummaryView } from "@team-manager/shared";

export type AccountListBooleanFilter = "true" | "false" | undefined;
export type AccountListSortField = "group" | "email" | "primaryPlan" | "lifecycle" | "capability";
export type AccountListSortOrder = "ascend" | "descend";

export interface AccountListSort {
  field: AccountListSortField;
  order: AccountListSortOrder;
}

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
  const textQuery = params.get("query");
  if (textQuery) query.set("query", textQuery);
  const primaryPlan = normalizePrimaryPlanFilter(params.get("primaryPlan"));
  if (primaryPlan) query.set("primaryPlan", primaryPlan);
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
  const sort = accountListSort(params);
  if (sort) {
    query.set("sortBy", sort.field);
    query.set("sortOrder", sort.order);
  }
  return query;
}

export function accountListSort(params: URLSearchParams): AccountListSort | undefined {
  const field = params.get("sortBy");
  const order = params.get("sortOrder");
  return isAccountListSortField(field) && (order === "ascend" || order === "descend")
    ? { field, order }
    : undefined;
}

export function updateAccountListSortParams(
  params: URLSearchParams,
  sort?: AccountListSort,
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (sort) {
    next.set("sortBy", sort.field);
    next.set("sortOrder", sort.order);
  } else {
    next.delete("sortBy");
    next.delete("sortOrder");
  }
  next.delete("page");
  return next;
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

type SortableAccount = Pick<
  UnifiedAccountSummaryView,
  "id" | "email" | "createdAt" | "group" | "primaryPlan" | "primaryPlanLifecycle" | "hasGamBinding"
>;

const PRIMARY_PLAN_ORDER: UnifiedAccountSummaryView["primaryPlan"][] = [
  "free",
  "go",
  "plus",
  "pro_5x",
  "pro_20x",
  "team_member",
  "business_usage_based",
  "business_fixed_seat",
  "unknown",
];

export function normalizePrimaryPlanFilter(value: string | null): string | undefined {
  if (!value) return undefined;
  return value === "business_two_seat" ? "business_fixed_seat" : value;
}

export function sortAccountList<T extends SortableAccount>(
  accounts: readonly T[],
  sort?: AccountListSort,
): T[] {
  return [...accounts].sort((left, right) => {
    const explicit = sort ? compareByField(left, right, sort) : 0;
    if (explicit !== 0) return explicit;
    const created = timestamp(left.createdAt) - timestamp(right.createdAt);
    return created || left.id.localeCompare(right.id);
  });
}

function compareByField(
  left: SortableAccount,
  right: SortableAccount,
  sort: AccountListSort,
): number {
  if (sort.field === "lifecycle") {
    const leftAt = left.primaryPlanLifecycle?.at;
    const rightAt = right.primaryPlanLifecycle?.at;
    if (!leftAt || !rightAt) return leftAt ? -1 : rightAt ? 1 : 0;
    const compared = timestamp(leftAt) - timestamp(rightAt);
    return sort.order === "descend" ? -compared : compared;
  }
  const compared = sort.field === "email"
    ? compareText(left.email, right.email)
    : sort.field === "group"
      ? compareText(left.group.name, right.group.name)
      : sort.field === "capability"
        ? Number(left.hasGamBinding) - Number(right.hasGamBinding)
        : PRIMARY_PLAN_ORDER.indexOf(left.primaryPlan) - PRIMARY_PLAN_ORDER.indexOf(right.primaryPlan);
  return sort.order === "descend" ? -compared : compared;
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "zh-CN", { numeric: true, sensitivity: "base" });
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isAccountListSortField(value: string | null): value is AccountListSortField {
  return value === "group" || value === "email" || value === "primaryPlan" || value === "lifecycle" || value === "capability";
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
