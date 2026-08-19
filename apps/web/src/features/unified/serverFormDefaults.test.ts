import { describe, expect, test } from "vitest";
import {
  normalizeGamRegistrationDefaults,
  normalizeSubscriptionDefaults,
} from "./serverFormDefaults.js";

describe("服务端表单默认值", () => {
  test("注册默认值只接受稳定的非敏感字段", () => {
    expect(normalizeGamRegistrationDefaults({
      groupId: " group-1 ",
      country: "cn",
      mailGroup: " mail-a ",
      email: "must-not-be-restored@example.com",
    })).toEqual({ groupId: "group-1", country: "CN", mailGroup: "mail-a" });
    expect(normalizeGamRegistrationDefaults({ country: "invalid" })).toEqual({ country: "US" });
  });

  test("套餐默认值显式区分优惠码是否启用", () => {
    expect(normalizeSubscriptionDefaults({ promoEnabled: true, promoCode: " SAVE20 " }))
      .toEqual({ promoEnabled: true, promoCode: "SAVE20" });
    expect(normalizeSubscriptionDefaults({ promoEnabled: "true", promoCode: "" }))
      .toEqual({ promoEnabled: false });
  });
});
