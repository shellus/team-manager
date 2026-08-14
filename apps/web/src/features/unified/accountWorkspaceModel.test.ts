import { describe, expect, it } from "vitest";
import {
  accountWorkspacePeople,
  resolveAccountWorkspaceId,
  selectAccountWorkspaceParams,
} from "./accountWorkspaceModel.js";

const workspaces = [
  { id: "first", externalId: "ext-1" },
  { id: "second", externalId: "ext-2" },
] as any[];

describe("account workspace model", () => {
  it("缺失或非法 Workspace 选择时使用第一个关系", () => {
    expect(resolveAccountWorkspaceId(workspaces)).toBe("first");
    expect(resolveAccountWorkspaceId(workspaces, "missing")).toBe("first");
    expect(resolveAccountWorkspaceId(workspaces, "second")).toBe("second");
  });

  it("切换 Workspace 时清理凭证分页和弹窗状态并保留子标签", () => {
    const input = new URLSearchParams("tab=workspaces&workspaceTab=billing&credentialsPage=2&modal=unused&personId=old&operationId=old");
    expect(selectAccountWorkspaceParams(input, "second").toString()).toBe(
      "tab=workspaces&workspaceTab=billing&workspaceId=second",
    );
  });

  it("成员与邀请只合并当前有效关系", () => {
    const rows = accountWorkspacePeople({
      members: [
        { id: "m1", status: "active" },
        { id: "m2", status: "removed" },
      ],
      invitations: [
        { id: "i1", status: "pending" },
        { id: "i2", status: "revoked" },
      ],
      seatSlots: [],
    } as any);
    expect(rows.map((row) => [row.rowKey, row.kind])).toEqual([
      ["member:m1", "member"],
      ["invitation:i1", "invitation"],
    ]);
  });

  it("按邮箱关联客户资料，并保留没有远端关系的资料", () => {
    const rows = accountWorkspacePeople({
      members: [{ id: "m1", status: "active", email: "Member@Example.com" }],
      invitations: [{ id: "i1", status: "pending", email: "invite@example.com" }],
      seatSlots: [
        { id: "s1", email: "member@example.com", contact: "member-contact" },
        { id: "s2", email: "orphan@example.com", remark: "历史资料" },
      ],
    } as any);
    expect(rows).toHaveLength(3);
    expect(rows[0].seatSlot?.id).toBe("s1");
    expect(rows[1].seatSlot).toBeUndefined();
    expect(rows[2]).toMatchObject({ kind: "customer", email: "orphan@example.com", seatSlot: { id: "s2" } });
  });
});
