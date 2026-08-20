import { describe, expect, test } from "vitest";
import {
  accountRemarkLabel,
  parseSessionEditorInput,
  primaryPlanLabel,
  seatUsageColor,
  profileAction,
  executeProfileAction,
  lifecycleLabel,
  selectUpgradeableWorkspaces,
} from "./accountActionsModel.js";

describe("account action UI model", () => {
  test("labels every primary plan without exposing its source", () => {
    expect(primaryPlanLabel("business_fixed_seat")).toBe("Business 固定席位");
    expect(primaryPlanLabel("business_usage_based")).toBe("0.52");
    expect(primaryPlanLabel("team_member")).toBe("Team 子号");
    expect(primaryPlanLabel("pro_5x")).toBe("Pro 5x");
  });

  test("labels primary plan renewal and expiration semantics", () => {
    expect(lifecycleLabel({ kind: "renews", at: "2030-02-03T00:00:00Z" })).toContain("续费");
    expect(lifecycleLabel({ kind: "expires", at: "2030-02-03T00:00:00Z" })).toContain("到期");
    expect(lifecycleLabel()).toBe("—");
  });

  test("uses the profile lifecycle to choose the single start or stop action", () => {
    expect(profileAction("queued", false)).toBe("pending");
    expect(profileAction("running", false)).toBe("stop");
    expect(profileAction("stopping", false)).toBe("pending");
    expect(profileAction("stopped", true)).toBe("stop");
    expect(profileAction("unknown", false)).toBe("start");
  });

  test("executes start and stop immediately through the selected command", async () => {
    const calls: string[] = [];
    const commands = {
      start: async (id: string) => calls.push(`start:${id}`),
      stop: async (id: string) => calls.push(`stop:${id}`),
    };
    await executeProfileAction("account-1", "start", commands);
    await executeProfileAction("account-1", "stop", commands);
    expect(calls).toEqual(["start:account-1", "stop:account-1"]);
  });

  test("shows only the explicit account remark below the email", () => {
    expect(accountRemarkLabel("Team1")).toBe("Team1");
    expect(accountRemarkLabel("  ")).toBe("");
    expect(accountRemarkLabel(undefined)).toBe("");
  });

  test("colors fixed-seat usage by capacity", () => {
    expect(seatUsageColor(1, 2)).toBe("gold");
    expect(seatUsageColor(2, 2)).toBe("green");
    expect(seatUsageColor(3, 2)).toBe("red");
    expect(seatUsageColor(4, undefined)).toBe("blue");
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
