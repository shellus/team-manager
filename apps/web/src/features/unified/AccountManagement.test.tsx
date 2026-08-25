import { App } from "antd";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { UnifiedAccountDetailView } from "@team-manager/shared";
import { Management } from "./AccountDetailPage.js";

describe("账号管理 GAM 重建入口", () => {
  it("只为已有 GAM 绑定的账号显示重建操作", () => {
    const render = (gamAccountRef?: string) => renderToStaticMarkup(
      <App>
        <Management
          account={{
            id: "account-id",
            email: "account@example.com",
            gamAccountRef,
            hasSession: true,
          } as UnifiedAccountDetailView}
          busy=""
          run={async () => undefined}
          onRebuildGam={() => undefined}
        />
      </App>,
    );

    expect(render("account@example.com")).toContain("重建 GAM");
    expect(render()).not.toContain("重建 GAM");
  });

  it("没有完整 Session 时禁用重建按钮并说明恢复条件", () => {
    const html = renderToStaticMarkup(
      <App>
        <Management
          account={{
            id: "account-id",
            email: "account@example.com",
            gamAccountRef: "account@example.com",
            hasSession: false,
          } as UnifiedAccountDetailView}
          busy=""
          run={async () => undefined}
          onRebuildGam={() => undefined}
        />
      </App>,
    );

    expect(html).toContain("当前账号没有完整 Session");
    const labelIndex = html.indexOf("重建 GAM");
    const button = html.slice(html.lastIndexOf("<button", labelIndex), html.indexOf(">", labelIndex) + 1);
    expect(button).toContain("disabled");
  });
});
