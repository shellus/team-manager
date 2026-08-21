import { Alert, Button, Checkbox, Descriptions, List, Skeleton, Space, Typography } from "antd";
import { useEffect, useState } from "react";
import type { AccountDeletionPreview } from "@team-manager/shared";
import { ProductModal } from "../../components/ProductOverlays.js";
import { unifiedApi } from "../../unifiedApi.js";

export async function executeAccountDeletion(
  accountId: string,
  onDeleted: () => void,
  setError: (message: string) => void,
): Promise<boolean> {
  try {
    await unifiedApi.deleteAccount(accountId);
    onDeleted();
    return true;
  } catch (error) {
    setError((error as Error).message);
    return false;
  }
}

export function canSubmitAccountDeletion(
  preview: AccountDeletionPreview | undefined,
  loading: boolean,
  workspaceDeletionAcknowledged: boolean,
): boolean {
  return Boolean(preview) && !loading && (
    preview?.ownedWorkspaces.length === 0 || workspaceDeletionAcknowledged
  );
}

export function AccountDeletionModal({
  accountId,
  email,
  open,
  onClose,
  onDeleted,
}: {
  accountId: string;
  email: string;
  open: boolean;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [preview, setPreview] = useState<AccountDeletionPreview>();
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [workspaceDeletionAcknowledged, setWorkspaceDeletionAcknowledged] = useState(false);

  const loadPreview = async () => {
    setLoading(true);
    setError("");
    setWorkspaceDeletionAcknowledged(false);
    try {
      setPreview(await unifiedApi.accountDeletionPreview(accountId));
    } catch (nextError) {
      setPreview(undefined);
      setError((nextError as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void loadPreview();
    else {
      setPreview(undefined);
      setError("");
      setSubmitting(false);
      setWorkspaceDeletionAcknowledged(false);
    }
  }, [open, accountId]);

  const remove = async () => {
    setSubmitting(true);
    setError("");
    const deleted = await executeAccountDeletion(accountId, onDeleted, setError);
    if (!deleted) setSubmitting(false);
  };

  return (
    <ProductModal
      title="删除账号及本地关联数据"
      open={open}
      width={640}
      closable={!submitting}
      maskClosable={!submitting}
      onCancel={submitting ? undefined : onClose}
      footer={
        <Space>
          <Button disabled={submitting} onClick={onClose}>取消</Button>
          <Button
            danger
            type="primary"
            loading={submitting}
            disabled={submitting || !canSubmitAccountDeletion(preview, loading, workspaceDeletionAcknowledged)}
            onClick={() => void remove()}
          >
            删除全部本地数据
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size={16} className="panel-stack">
        <Alert
          type="warning"
          showIcon
          message={`将彻底删除 ${email}`}
          description="删除后无法从 Team Manager 恢复。此操作只删除本地数据，不会登录该账号，也不会调用 ChatGPT 删除远程 Workspace。"
        />
        {loading && <Skeleton active paragraph={{ rows: 5 }} />}
        {error && (
          <Alert
            type="error"
            showIcon
            message={preview ? "删除失败" : "无法加载删除范围"}
            description={error}
            action={!preview && <Button size="small" onClick={() => void loadPreview()}>重新加载</Button>}
          />
        )}
        {preview && (
          <>
            <Typography.Text strong>
              本次将删除 {preview.ownedWorkspaces.length} 个由该账号拥有的本地 Workspace
            </Typography.Text>
            {preview.ownedWorkspaces.length > 0 && (
              <>
                <List
                  size="small"
                  bordered
                  dataSource={preview.ownedWorkspaces}
                  renderItem={(workspace) => (
                    <List.Item>
                      <List.Item.Meta
                        title={workspace.name || workspace.externalId}
                        description={`活动成员 ${workspace.activeMembershipCount}，凭证 ${workspace.credentialCount}，客户席位 ${workspace.seatSlotCount}，订单 ${workspace.orderCount}`}
                      />
                    </List.Item>
                  )}
                />
                <Checkbox
                  checked={workspaceDeletionAcknowledged}
                  disabled={submitting}
                  onChange={(event) => setWorkspaceDeletionAcknowledged(event.target.checked)}
                >
                  我确认删除上述 {preview.ownedWorkspaces.length} 个本地 Workspace 及其关联数据
                </Checkbox>
              </>
            )}
            <Descriptions
              bordered
              size="small"
              column={{ xs: 1, sm: 2 }}
              items={[
                { key: "personalSpaces", label: "个人空间", children: preview.resources.personalSpaces },
                { key: "sessionRecords", label: "Session", children: preview.resources.sessionRecords },
                { key: "accessContexts", label: "访问上下文", children: preview.resources.accessContexts },
                { key: "gamBindings", label: "GAM 绑定", children: preview.resources.gamBindings },
                { key: "memberships", label: "成员关系", children: preview.resources.memberships },
                { key: "invitations", label: "邀请", children: preview.resources.invitations },
                { key: "credentials", label: "Workspace 凭证", children: preview.resources.credentials },
                { key: "seatSlots", label: "客户席位", children: preview.resources.seatSlots },
                { key: "operations", label: "自动化操作", children: preview.resources.operations },
                { key: "maintenances", label: "订单维护", children: preview.resources.maintenances },
                { key: "orders", label: "Team 订单", children: preview.resources.orders },
                { key: "activityLogs", label: "活动日志", children: preview.resources.activityLogs },
              ]}
            />
          </>
        )}
      </Space>
    </ProductModal>
  );
}
