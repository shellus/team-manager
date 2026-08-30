import { describe, expect, test } from "vitest";
import type { PromotionLookupView, WorkspacePromotionMetadataView } from "@team-manager/shared";
import { promotionDetails, promotionDiscountText } from "./WorkspacePromotionModal.js";

describe("优惠码结构化信息", () => {
  test("金额型优惠优先展示金额和币种，不显示无意义的优惠席位", () => {
    const details = promotionDetails({
      planName: "chatgptteamplan",
      discountValue: 25,
      discountCurrency: "USD",
      durationPeriods: 48,
      durationPeriod: "month",
      promotionType: "discount",
      pricePeriod: "recurring",
      processor: "stripe",
    }, preview());

    expect(details[0]?.label).toBe("优惠金额");
    expect(details.some((item) => item.label === "优惠席位")).toBe(false);
    expect(details.find((item) => item.label === "优惠类型")?.children).toBe("固定金额减免");
    expect(details.find((item) => item.label === "生效方式")?.children).toBe("每个账期重复生效");
    expect(promotionDiscountText(25, "USD")).toContain("25.00");
    expect(promotionDiscountText(25, "USD")).toContain("USD");
  });

  test("席位型优惠只展示上游返回的优惠席位", () => {
    const metadata: WorkspacePromotionMetadataView = {
      planName: "chatgptteamplan",
      quantityOff: 1,
    };
    const details = promotionDetails(metadata, preview());

    expect(details[0]?.label).toBe("优惠席位");
    expect(details.some((item) => item.label === "优惠金额")).toBe(false);
    expect(details.find((item) => item.label === "优惠类型")?.children).toBe("按席位减免");
  });
});

function preview(): PromotionLookupView {
  return {
    promoCode: "PROMO",
    target: { kind: "personal" },
    targetLabel: "个人空间",
    isEligible: true,
    subscription: { planType: "pro", billingCurrency: "JPY", willRenew: false },
    wouldEnableRenewal: true,
  };
}
