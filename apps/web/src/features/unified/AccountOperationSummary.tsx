import { Button, Progress, Space, Tag, Typography } from "antd";
import type { AccountManagerOperationView } from "@team-manager/shared";

const STATUS_LABEL = {
  queued: "等待开始",
  running: "进行中",
  waiting_for_otp: "等待验证码",
  waiting_manual: "等待处理",
  succeeded: "已完成",
  failed: "失败",
  interrupted: "已中断",
} as const;

const TYPE_LABEL: Record<string, string> = {
  register_account: "注册账号",
  change_personal_subscription: "个人套餐",
  cancel_personal_subscription_renewal: "取消续费",
  open_business_subscription: "Business 套餐",
  add_personal_payment_method: "绑定支付方式",
};

export function AccountOperationSummary({
  operation,
  onOpen,
}: {
  operation: AccountManagerOperationView;
  onOpen: (id: string) => void;
}) {
  const failed = operation.status === "failed" || operation.status === "interrupted";
  return (
    <div className={`account-operation-summary${failed ? " is-error" : ""}`}>
      <Space size={6} wrap>
        <Tag color={failed ? "error" : operation.status === "succeeded" ? "success" : "processing"}>
          {STATUS_LABEL[operation.status]}
        </Tag>
        <Typography.Text strong>{TYPE_LABEL[operation.type] ?? "账号操作"}</Typography.Text>
        <Typography.Text type="secondary">{operation.phase || "准备中"}</Typography.Text>
        <Button type="link" size="small" onClick={() => onOpen(operation.id)}>
          {failed || operation.status.startsWith("waiting") ? "处理" : "详情"}
        </Button>
      </Space>
      {!operation.status.startsWith("waiting") && operation.status !== "succeeded" && (
        <Progress percent={operation.progress ?? 0} size="small" status={failed ? "exception" : "active"} showInfo={false} />
      )}
      {operation.errorMessage && <Typography.Text type="danger">{operation.errorMessage}</Typography.Text>}
    </div>
  );
}

export function isActiveOperation(operation?: AccountManagerOperationView): boolean {
  return Boolean(operation && !["succeeded", "failed", "interrupted"].includes(operation.status));
}
