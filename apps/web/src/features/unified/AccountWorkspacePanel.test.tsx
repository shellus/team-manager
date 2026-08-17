import { App } from "antd";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { UnifiedAccountDetailView } from "@team-manager/shared";
import { AccountWorkspacePanel } from "./AccountWorkspacePanel.js";

describe("账号 Workspace 面板", () => {
  it("没有活动 Workspace 时仍显示关系同步入口", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <App>
          <AccountWorkspacePanel
            account={{ id: "account-id", workspaces: [], removedWorkspaces: [] } as unknown as UnifiedAccountDetailView}
            poolGroups={[]}
            onAccountChanged={async () => undefined}
          />
        </App>
      </MemoryRouter>,
    );

    expect(html).toContain("选择 Workspace");
    expect(html).toContain("同步账号与 Workspace 关系");
    expect(html.indexOf("选择 Workspace")).toBeLessThan(html.indexOf("同步账号与 Workspace 关系"));
  });

  it("展示已退出 Workspace 的本地删除入口", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <App>
          <AccountWorkspacePanel
            account={{
              id: "account-id",
              workspaces: [],
              removedWorkspaces: [{
                id: "workspace-id",
                externalId: "remote-workspace-id",
                name: "历史 Workspace",
                status: "active",
                plan: "business",
                role: "member",
                membershipStatus: "removed",
                manageable: false,
                removedAt: "2026-08-17T00:00:00.000Z",
                canDeleteLocally: true,
              }],
            } as unknown as UnifiedAccountDetailView}
            poolGroups={[]}
            onAccountChanged={async () => undefined}
          />
        </App>
      </MemoryRouter>,
    );

    expect(html).toContain("已退出的 Workspace");
    expect(html).toContain("历史 Workspace");
    expect(html).toContain("删除本地数据");
  });
});
