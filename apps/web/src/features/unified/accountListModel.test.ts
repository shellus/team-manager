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
      "groupId=group-a&query=alice&modal=session&actionAccountId=account-1&operationId=op-1&hasGamBinding=true",
    );

    expect(accountListRequestQuery(params).toString()).toBe(
      "query=alice&hasGamBinding=true&isBanned=false",
    );
    expect(showsBannedAccounts(params)).toBe(false);
  });

  test("showBanned removes the banned-state restriction", () => {
    const params = new URLSearchParams(
      "showBanned=true&groupId=group-a&isBanned=false&primaryPlan=plus",
    );

    expect(accountListRequestQuery(params).toString()).toBe(
      "primaryPlan=plus",
    );
    expect(showsBannedAccounts(params)).toBe(true);
  });

  test("drops removed and negative boolean filters from old URLs", () => {
    const params = new URLSearchParams(
      "hasManageableWorkspace=true&isWorkspaceMember=true&hasWorkspaceCredential=true&hasSession=true&hasGamBinding=false&hasRunningProfile=true",
    );

    expect(accountListRequestQuery(params).toString()).toBe(
      "hasRunningProfile=true&isBanned=false",
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
