import { App } from "antd";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { UnifiedAccountDetailView } from "@team-manager/shared";
import { AccountWorkspacePanel, relationReleaseCopy } from "./AccountWorkspacePanel.js";

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

  it("没有其他账号使用时仍只展示退出关系删除入口", () => {
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
    expect(html).toContain("删除退出记录");
    expect(html).not.toContain("删除本地数据");
  });

  it("其他账号仍在使用 Workspace 时允许删除当前账号的退出记录", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <App>
          <AccountWorkspacePanel
            account={{
              id: "account-id",
              workspaces: [],
              removedWorkspaces: [{
                id: "shared-workspace-id",
                externalId: "shared-remote-workspace-id",
                name: "共享历史 Workspace",
                status: "active",
                plan: "business",
                role: "member",
                membershipStatus: "removed",
                manageable: false,
                removedAt: "2026-08-17T00:00:00.000Z",
              }],
            } as unknown as UnifiedAccountDetailView}
            poolGroups={[]}
            onAccountChanged={async () => undefined}
          />
        </App>
      </MemoryRouter>,
    );

    expect(html).toContain("删除退出记录");
    expect(html).not.toContain("其他账号仍在使用");
  });

  it("按远端关系命名操作，不向用户暴露释放术语", () => {
    expect(relationReleaseCopy({ kind: "member" }).okText).toBe("移除成员");
    expect(relationReleaseCopy({ kind: "invitation" }).okText).toBe("撤销邀请");
    expect(relationReleaseCopy({ kind: "customer" }).okText).toBe("删除资料");
    expect(relationReleaseCopy({ kind: "member" }).content).toContain("租客资料也会一并删除");
  });
});
