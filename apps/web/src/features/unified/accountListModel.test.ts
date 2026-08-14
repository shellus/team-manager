import { describe, expect, test } from "vitest";
import {
  accountListBooleanFilter,
  accountListRequestQuery,
  countAccountsByGroup,
  selectAccountsByGroup,
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
});
