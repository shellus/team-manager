import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Descriptions,
  Progress,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import type {
  AutomationOperationView,
  OperationDetailView,
} from "@team-manager/shared";
import { unifiedApi } from "../unifiedApi.js";
import { LoadBoundary, formatPaymentCardLast4, formatTime } from "./ProductPrimitives.js";
import {
  operationDrawerActions,
  operationPhaseLabel,
  operationTypeLabel,
} from "../features/unified/operationUiModel.js";
import { ProductDrawer, useProductModal } from "./ProductOverlays.js";

export function OperationDrawer({
  operation,
  operationId,
  open,
  onClose,
  onChanged,
}: {
  operation?: AutomationOperationView;
  operationId?: string;
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const productModal = useProductModal();
  const [detail, setDetail] = useState<OperationDetailView>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const targetOperationId = operationId ?? operation?.id;
  const load = async () => {
    if (!targetOperationId) return;
    setLoading(true);
    setError("");
    try {
      setDetail(await unifiedApi.operation(targetOperationId));
    } catch (e) {
      setError((e as Error).message);
      setDetail(undefined);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (open) void load();
  }, [open, targetOperationId]);
  useEffect(() => {
    const status = detail?.status ?? operation?.status;
    if (
      !open ||
      !status ||
      ["succeeded", "failed", "interrupted"].includes(status)
    )
      return;
    const timer = window.setInterval(() => void load(), 3_000);
    return () => window.clearInterval(timer);
  }, [
    open,
    targetOperationId,
    detail?.status,
    operation?.status,
  ]);
  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setError("");
    try {
      await action();
      await load();
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const value = detail ?? operation;
  const actions = value ? operationDrawerActions(value) : undefined;
  return (
    <>
      <ProductDrawer
        title="操作详情"
        open={open}
        onClose={onClose}
        width={720}
        extra={<Button onClick={() => void load()}>刷新状态</Button>}
      >
        <LoadBoundary
          loading={loading && !value}
          error={!value ? error : undefined}
          onRetry={load}
        >
          {error && value && (
            <Alert
              type="error"
              showIcon
              message={error}
              closable
              onClose={() => setError("")}
            />
          )}
          {value && (
            <Space direction="vertical" size={16} className="panel-stack">
              <Descriptions
                bordered
                size="small"
                column={2}
                items={[
                  { key: "id", label: "操作 ID", children: value.id },
                  { key: "type", label: "类型", children: operationTypeLabel(value.type) },
                  {
                    key: "status",
                    label: "状态",
                    children: <Tag>{operationPhaseLabel(value.status)}</Tag>,
                  },
                  { key: "phase", label: "阶段", children: operationPhaseLabel(value.phase) },
                  {
                    key: "created",
                    label: "创建",
                    children: formatTime(value.createdAt),
                  },
                  {
                    key: "updated",
                    label: "更新",
                    children: formatTime(value.updatedAt),
                  },
                ]}
              />
              <Progress
                percent={Math.max(0, Math.min(100, value.progress ?? 0))}
                status={
                  value.status === "failed"
                    ? "exception"
                    : value.status === "succeeded"
                      ? "success"
                      : "active"
                }
              />
              {value.errorMessage && (
                <Alert
                  type="error"
                  showIcon
                  message={value.errorMessage}
                  description={value.errorCode}
                />
              )}
              <Space wrap>
                {actions?.remove && <Button
                  loading={busy === "delete"}
                  danger
                  onClick={() =>
                    productModal.confirm({
                      title: "清理操作记录？",
                      content: "只清理操作记录，不回滚已经发生的上游行为。",
                      onOk: () =>
                        run("delete", () =>
                          unifiedApi.deleteOperation(value.id),
                        ).then(onClose),
                    })
                  }
                >
                  清理记录
                </Button>}
              </Space>
              {detail?.events && (
                <Table
                  rowKey="id"
                  pagination={false}
                  dataSource={detail.events}
                  scroll={{ x: 700 }}
                  columns={[
                    {
                      title: "时间",
                      dataIndex: "occurredAt",
                      render: formatTime,
                    },
                    { title: "阶段", dataIndex: "phase", render: operationPhaseLabel },
                    { title: "状态", dataIndex: "status", render: operationPhaseLabel },
                    {
                      title: "说明",
                      dataIndex: "payload",
                      render: operationEventSummary,
                    },
                  ]}
                />
              )}
              {(detail?.payment || detail?.effectiveAt) && (
                <Descriptions
                  bordered
                  size="small"
                  column={2}
                  items={[
                    ...(detail?.payment
                      ? [
                          { key: "payment-status", label: "支付结果", children: detail.payment.resultCode },
                          { key: "payment-card", label: "支付卡", children: [detail.payment.cardBrand, formatPaymentCardLast4(detail.payment.cardLast4)].filter(Boolean).join(" ") || "—" },
                          { key: "payment-amount", label: "支付金额", children: [detail.payment.currency, detail.payment.amount].filter(Boolean).join(" ") || "—" },
                          { key: "payment-time", label: "支付时间", children: formatTime(detail.payment.submittedAt ?? detail.payment.createdAt) },
                        ]
                      : []),
                    ...(detail?.effectiveAt
                      ? [{ key: "effective", label: "生效时间", children: formatTime(detail.effectiveAt) }]
                      : []),
                  ]}
                />
              )}
            </Space>
          )}
        </LoadBoundary>
      </ProductDrawer>
    </>
  );
}

function operationEventSummary(payload: Record<string, unknown>): string {
  const candidates = [payload.message, payload.detail, payload.reason, payload.error, payload.result];
  const text = candidates.find((item) => typeof item === "string" && item.trim());
  if (typeof text === "string") return text;
  const entries = Object.entries(payload)
    .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${String(value)}`);
  return entries.join(" · ") || "—";
}
