import { afterEach, describe, expect, it, vi } from "vitest";
import { unifiedApi } from "../../unifiedApi.js";
import type { AccountDeletionPreview } from "@team-manager/shared";
import { canSubmitAccountDeletion, executeAccountDeletion } from "./AccountDeletionModal.js";

function deletionPreview(ownedWorkspaceCount: number): AccountDeletionPreview {
  return {
    account: { id: "account-id", email: "owner@example.com" },
    ownedWorkspaces: Array.from({ length: ownedWorkspaceCount }, (_, index) => ({
      id: `workspace-${index}`,
      externalId: `external-${index}`,
      name: `Workspace ${index}`,
      activeMembershipCount: 1,
      credentialCount: 0,
      seatSlotCount: 0,
      orderCount: 0,
    })),
    resources: {
      personalSpaces: 1,
      sessionRecords: 1,
      accessContexts: 0,
      gamBindings: 0,
      memberships: 1,
      invitations: 0,
      credentials: 0,
      seatSlots: 0,
      operations: 0,
      maintenances: 0,
      orders: 0,
      activityLogs: 0,
    },
    remoteWorkspaceDeletion: false,
  };
}

describe("账号删除反馈", () => {
  afterEach(() => vi.restoreAllMocks());

  it("后端拒绝删除时在弹框内保留错误且不跳转", async () => {
    vi.spyOn(unifiedApi, "deleteAccount").mockRejectedValue(new Error("关联数据删除失败"));
    const onDeleted = vi.fn();
    const setError = vi.fn();

    await expect(executeAccountDeletion("account-id", onDeleted, setError)).resolves.toBe(false);
    expect(setError).toHaveBeenCalledWith("关联数据删除失败");
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("后端删除成功后才触发跳转", async () => {
    vi.spyOn(unifiedApi, "deleteAccount").mockResolvedValue({
      deleted: true,
      deletedWorkspaceCount: 1,
      removedCredentialArtifactCount: 0,
      credentialArtifactCleanupFailures: 0,
    });
    const onDeleted = vi.fn();
    const setError = vi.fn();

    await expect(executeAccountDeletion("account-id", onDeleted, setError)).resolves.toBe(true);
    expect(onDeleted).toHaveBeenCalledOnce();
    expect(setError).not.toHaveBeenCalled();
  });
});

describe("账号删除确认门槛", () => {
  it("没有归属 Workspace 时无需额外勾选", () => {
    expect(canSubmitAccountDeletion(deletionPreview(0), false, false)).toBe(true);
  });

  it("存在归属 Workspace 时必须额外勾选", () => {
    const preview = deletionPreview(1);

    expect(canSubmitAccountDeletion(preview, false, false)).toBe(false);
    expect(canSubmitAccountDeletion(preview, false, true)).toBe(true);
  });

  it("预览未就绪或正在加载时始终禁止删除", () => {
    expect(canSubmitAccountDeletion(undefined, false, true)).toBe(false);
    expect(canSubmitAccountDeletion(deletionPreview(0), true, true)).toBe(false);
  });
});
