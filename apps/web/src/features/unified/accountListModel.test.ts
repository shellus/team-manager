import { describe, expect, test } from "vitest";
import {
  ACCOUNT_LIST_FILTER_STORAGE_KEY,
  accountListBooleanFilter,
  accountListSort,
  accountListRequestQuery,
  accountListPersistedFilterQuery,
  accountSelectionState,
  countAccountsByGroup,
  persistAccountListFilters,
  normalizePrimaryPlanFilter,
  restorePersistedAccountListFilters,
  selectAccountsByGroup,
  sortAccountList,
  updateAccountListSortParams,
} from "./accountListModel.js";

const account = (id: string, groupId: string) => ({
  id,
  group: { id: groupId, name: groupId },
});

describe("account list filters", () => {
  test("represents every boolean filter as all, yes, or no", () => {
    expect(accountListBooleanFilter(new URLSearchParams(), "hasGamBinding")).toBeUndefined();
    expect(accountListBooleanFilter(new URLSearchParams("hasGamBinding=true"), "hasGamBinding")).toBe("true");
    expect(accountListBooleanFilter(new URLSearchParams("hasGamBinding=false"), "hasGamBinding")).toBe("false");
    expect(accountListBooleanFilter(new URLSearchParams("hasGamBinding=all"), "hasGamBinding")).toBeUndefined();
    expect(accountListBooleanFilter(new URLSearchParams("isBanned=true"), "isBanned")).toBe("true");
  });

  test("defaults every boolean filter to all and leaves group selection to the UI", () => {
    const params = new URLSearchParams(
      "groupId=group-a&query=alice&modal=edit&actionAccountId=account-1&operationId=op-1&hasGamBinding=true",
    );

    expect(accountListRequestQuery(params).toString()).toBe(
      "query=alice&hasGamBinding=true",
    );
  });

  test("preserves the explicit banned-state filter", () => {
    const params = new URLSearchParams(
      "groupId=group-a&isBanned=false&primaryPlan=plus",
    );

    expect(accountListRequestQuery(params).toString()).toBe(
      "primaryPlan=plus&isBanned=false",
    );
  });

  test("normalizes the retired two-seat filter to fixed-seat Business", () => {
    expect(normalizePrimaryPlanFilter("business_two_seat")).toBe("business_fixed_seat");
    expect(accountListRequestQuery(new URLSearchParams("primaryPlan=business_two_seat")).toString())
      .toBe("primaryPlan=business_fixed_seat");
  });

  test("drops removed filters and preserves every tri-state boolean value", () => {
    const params = new URLSearchParams(
      "hasManageableWorkspace=true&isWorkspaceMember=true&hasWorkspaceCredential=true&hasSession=true&hasGamBinding=false&hasRunningProfile=true",
    );

    expect(accountListRequestQuery(params).toString()).toBe(
      "hasGamBinding=false&hasRunningProfile=true",
    );
  });

  test("derives group counts and the selected table from one filtered result", () => {
    const accounts = [
      account("account-1", "group-a"),
      account("account-2", "group-a"),
      account("account-3", "group-b"),
    ];

    expect(Object.fromEntries(countAccountsByGroup(accounts))).toEqual({
      "group-a": 2,
      "group-b": 1,
    });
    expect(selectAccountsByGroup(accounts, "group-b").map(({ id }) => id)).toEqual([
      "account-3",
    ]);
    expect(selectAccountsByGroup(accounts).map(({ id }) => id)).toEqual([
      "account-1",
      "account-2",
      "account-3",
    ]);
  });

  test("derives selection state from the complete filtered result", () => {
    expect(accountSelectionState([], ["a", "b"])).toEqual({
      allSelected: false,
      partiallySelected: false,
    });
    expect(accountSelectionState(["a"], ["a", "b"])).toEqual({
      allSelected: false,
      partiallySelected: true,
    });
    expect(accountSelectionState(["a", "b", "outside"], ["a", "b"])).toEqual({
      allSelected: true,
      partiallySelected: false,
    });
    expect(accountSelectionState(["outside"], [])).toEqual({
      allSelected: false,
      partiallySelected: false,
    });
  });

  test("persists only account filters and restores them for a filterless URL", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
    const filtered = new URLSearchParams(
      "query=alice&groupId=group-a&primaryPlan=plus&hasGamBinding=true&hasRunningProfile=false&isBanned=true&page=3&modal=groups&operationId=operation-a",
    );

    persistAccountListFilters(filtered, storage);
    expect(values.get(ACCOUNT_LIST_FILTER_STORAGE_KEY)).toBe(
      "query=alice&primaryPlan=plus&hasGamBinding=true&hasRunningProfile=false&isBanned=true&groupId=group-a",
    );
    expect(accountListPersistedFilterQuery(filtered).has("page")).toBe(false);

    expect(
      restorePersistedAccountListFilters(
        new URLSearchParams("page=2"),
        storage,
      )?.toString(),
    ).toBe(
      "page=2&query=alice&primaryPlan=plus&hasGamBinding=true&hasRunningProfile=false&isBanned=true&groupId=group-a",
    );
  });

  test("keeps explicit URL filters authoritative and reset clears storage", () => {
    const values = new Map([[ACCOUNT_LIST_FILTER_STORAGE_KEY, "query=remembered&groupId=old"]]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };

    expect(
      restorePersistedAccountListFilters(
        new URLSearchParams("primaryPlan=pro_5x"),
        storage,
      ),
    ).toBeUndefined();
    persistAccountListFilters(new URLSearchParams(), storage);
    expect(values.has(ACCOUNT_LIST_FILTER_STORAGE_KEY)).toBe(false);
  });

  test("defaults to oldest accounts and supports explicit sortable fields", () => {
    const sortable = [
      { id: "new", email: "z@example.com", createdAt: "2026-01-02T00:00:00Z", group: { id: "b", name: "乙组" }, primaryPlan: "plus" as const, hasGamBinding: false },
      { id: "old", email: "a@example.com", createdAt: "2026-01-01T00:00:00Z", group: { id: "a", name: "甲组" }, primaryPlan: "free" as const, hasGamBinding: true },
      { id: "middle", email: "m@example.com", createdAt: "2026-01-01T12:00:00Z", group: { id: "b", name: "乙组" }, primaryPlan: "pro_20x" as const, hasGamBinding: false, primaryPlanLifecycle: { kind: "renews" as const, at: "2027-01-01T12:00:01Z" } },
    ];

    expect(sortAccountList(sortable).map(({ id }) => id)).toEqual(["old", "middle", "new"]);
    expect(sortAccountList(sortable, { field: "email", order: "descend" }).map(({ id }) => id)).toEqual(["new", "middle", "old"]);
    expect(sortAccountList(sortable, { field: "lifecycle", order: "ascend" }).map(({ id }) => id)).toEqual(["middle", "old", "new"]);
    expect(sortAccountList(sortable, { field: "capability", order: "descend" }).map(({ id }) => id)).toEqual(["old", "middle", "new"]);
  });

  test("stores explicit sorting and cancellation returns to the default order", () => {
    const sorted = updateAccountListSortParams(
      new URLSearchParams("query=alice&page=4"),
      { field: "lifecycle", order: "descend" },
    );
    expect(sorted.toString()).toBe("query=alice&sortBy=lifecycle&sortOrder=descend");
    expect(accountListSort(sorted)).toEqual({ field: "lifecycle", order: "descend" });
    expect(accountListPersistedFilterQuery(sorted).toString()).toBe("query=alice&sortBy=lifecycle&sortOrder=descend");
    expect(updateAccountListSortParams(sorted).toString()).toBe("query=alice");
  });
});
