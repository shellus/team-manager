import { describe, expect, test } from "vitest";
import {
  accountRemarkLabel,
  accountDetailDescription,
  parseSessionEditorInput,
  primaryPlanLabel,
  seatUsageColor,
  actionModalFromParams,
  lifecycleLabel,
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

  test("shows only the explicit account remark below the email", () => {
    expect(accountRemarkLabel("Team1")).toBe("Team1");
    expect(accountRemarkLabel("  ")).toBe("");
    expect(accountRemarkLabel(undefined)).toBe("");
  });

  test("adds the account remark to the detail header description", () => {
    expect(accountDetailDescription("默认分组", "母号备注")).toBe("账号 · 默认分组 · 备注：母号备注");
    expect(accountDetailDescription("默认分组", "  ")).toBe("账号 · 默认分组");
    expect(accountDetailDescription("默认分组")).toBe("账号 · 默认分组");
  });

  test("colors fixed-seat usage by capacity", () => {
    expect(seatUsageColor(1, 2)).toBe("gold");
    expect(seatUsageColor(2, 2)).toBe("green");
    expect(seatUsageColor(3, 2)).toBe("red");
    expect(seatUsageColor(4, undefined)).toBe("blue");
  });

  test("accepts only an object as editable Session JSON", () => {
    expect(parseSessionEditorInput('{"accessToken":"secret"}')).toEqual({
      accessToken: "secret",
    });
    expect(() => parseSessionEditorInput("[]")).toThrow(
      "Session 必须是 JSON 对象",
    );
  });

  test("restores account action modals from the URL and ignores retired ones", () => {
    expect(actionModalFromParams(new URLSearchParams("modal=proxy"))).toBe("proxy");
    expect(actionModalFromParams(new URLSearchParams("modal=rebuild-gam"))).toBeUndefined();
  });
});
