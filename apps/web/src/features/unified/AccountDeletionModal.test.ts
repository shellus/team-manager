import { afterEach, describe, expect, it, vi } from "vitest";
import { unifiedApi } from "../../unifiedApi.js";
import { executeAccountDeletion } from "./AccountDeletionModal.js";

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
