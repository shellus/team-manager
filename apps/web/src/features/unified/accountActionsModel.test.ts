import { describe, expect, test } from "vitest";
import {
  actionModalFromParams,
  accountRemarkLabel,
  parseSessionEditorInput,
  primaryPlanLabel,
  setAccountActionInParams,
  profileAction,
  selectUpgradeableWorkspaces,
} from "./accountActionsModel.js";

describe("account action UI model", () => {
  test("labels every primary plan without exposing its source", () => {
    expect(primaryPlanLabel("business_two_seat")).toBe("双席位");
    expect(primaryPlanLabel("business_usage_based")).toBe("0.52");
    expect(primaryPlanLabel("team_member")).toBe("Team 子号");
    expect(primaryPlanLabel("pro_5x")).toBe("Pro 5x");
  });

  test("uses the profile lifecycle to choose the single start or stop action", () => {
    expect(profileAction("queued", false)).toBe("pending");
    expect(profileAction("running", false)).toBe("stop");
    expect(profileAction("stopping", false)).toBe("pending");
    expect(profileAction("stopped", true)).toBe("stop");
    expect(profileAction("unknown", false)).toBe("start");
  });

  test("persists and clears an account modal in URL parameters", () => {
    const opened = setAccountActionInParams(
      new URLSearchParams("query=alice"),
      "session",
      "account-1",
    );
    expect(opened.toString()).toBe(
      "query=alice&modal=session&actionAccountId=account-1",
    );
    expect(actionModalFromParams(opened)).toBe("session");

    const closed = setAccountActionInParams(opened);
    expect(closed.toString()).toBe("query=alice");
    expect(actionModalFromParams(closed)).toBeUndefined();
    expect(actionModalFromParams(new URLSearchParams("modal=profile"))).toBe(
      "profile",
    );
  });

  test("shows only the explicit account remark below the email", () => {
    expect(accountRemarkLabel("Team1")).toBe("Team1");
    expect(accountRemarkLabel("  ")).toBe("—");
    expect(accountRemarkLabel(undefined)).toBe("—");
  });

  test("offers only active owner or admin workspaces for Business upgrade", () => {
    const workspaces = [
      { id: "owner", manageable: true, membershipStatus: "active", role: "owner" },
      { id: "admin", manageable: true, membershipStatus: "active", role: "admin" },
      { id: "member", manageable: false, membershipStatus: "active", role: "member" },
      { id: "removed", manageable: true, membershipStatus: "removed", role: "owner" },
    ];
    expect(selectUpgradeableWorkspaces(workspaces).map(({ id }) => id)).toEqual([
      "owner",
      "admin",
    ]);
  });

  test("accepts only an object as editable Session JSON", () => {
    expect(parseSessionEditorInput('{"accessToken":"secret"}')).toEqual({
      accessToken: "secret",
    });
    expect(() => parseSessionEditorInput("[]")).toThrow(
      "Session 必须是 JSON 对象",
    );
  });
});
