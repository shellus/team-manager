import { describe, expect, test } from "vitest";
import {
  accountListRequestQuery,
  countAccountsByGroup,
  selectAccountsByGroup,
  showsBannedAccounts,
} from "./accountListModel.js";

const account = (id: string, groupId: string) => ({
  id,
  group: { id: groupId, name: groupId },
});

describe("account list filters", () => {
  test("defaults to hiding banned accounts and leaves group selection to the UI", () => {
    const params = new URLSearchParams(
      "groupId=group-a&query=alice&modal=groups",
    );

    expect(accountListRequestQuery(params).toString()).toBe(
      "query=alice&isBanned=false",
    );
    expect(showsBannedAccounts(params)).toBe(false);
  });

  test("showBanned removes the banned-state restriction", () => {
    const params = new URLSearchParams(
      "showBanned=true&groupId=group-a&isBanned=false&personalPlan=plus",
    );

    expect(accountListRequestQuery(params).toString()).toBe(
      "personalPlan=plus",
    );
    expect(showsBannedAccounts(params)).toBe(true);
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
