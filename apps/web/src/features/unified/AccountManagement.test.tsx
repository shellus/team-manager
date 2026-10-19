import { App } from "antd";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { UnifiedAccountDetailView } from "@team-manager/shared";
import { Management, proxyLabel } from "./AccountDetailPage.js";

describe("账号管理出口代理", () => {
  it("住宅代理优先显示地区和 SID", () => {
    expect(proxyLabel({
      proxyConfigured: true,
      residentialProxy: { sid: "Ab12Cd34", country: "SG", asn: null, state: null, city: null },
    })).toBe("住宅代理 SG · SID Ab12Cd34");
    expect(proxyLabel({
      proxyConfigured: true,
      residentialProxy: { sid: "Ab12Cd34", country: "US", asn: null, state: "Texas", city: "Abilene" },
    })).toBe("住宅代理 US / Texas / Abilene · SID Ab12Cd34");
  });

  it("区分手工代理与默认出口", () => {
    expect(proxyLabel({ proxyConfigured: true })).toBe("手工代理地址");
    expect(proxyLabel({ proxyConfigured: false })).toBe("未配置（默认出口）");
  });

  it("账号管理页展示出口代理与本地 Session", () => {
    const html = renderToStaticMarkup(
      <App>
        <Management
          account={{
            id: "account-id",
            email: "account@example.com",
            proxyConfigured: false,
            hasSession: true,
          } as UnifiedAccountDetailView}
        />
      </App>,
    );
    expect(html).toContain("未配置（默认出口）");
    expect(html).toContain("可用");
  });
});
