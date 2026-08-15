import { useEffect, useState } from "react";
import { Alert, Button, Checkbox, Descriptions, Form, Input, Space, Typography } from "antd";
import type {
  WorkspacePromotionApplyResultView,
  WorkspacePromotionMetadataView,
  WorkspacePromotionPreviewView,
} from "@team-manager/shared";
import { ProductModal, useProductMessage } from "../../components/ProductOverlays.js";
import { formatTime } from "../../components/ProductPrimitives.js";
import { unifiedApi } from "../../unifiedApi.js";

interface PromotionFormValues {
  promoCode: string;
}

export function WorkspacePromotionModal({
  workspaceId,
  accountId,
  open,
  onClose,
  onApplied,
}: {
  workspaceId: string;
  accountId: string;
  open: boolean;
  onClose: () => void;
  onApplied: (result: WorkspacePromotionApplyResultView) => Promise<void>;
}) {
  const productMessage = useProductMessage();
  const [form] = Form.useForm<PromotionFormValues>();
  const [preview, setPreview] = useState<WorkspacePromotionPreviewView>();
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState<"preview" | "apply">();
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) return;
    form.resetFields();
    setPreview(undefined);
    setAcknowledged(false);
    setBusy(undefined);
    setError("");
  }, [form, open]);

  const previewPromotion = async ({ promoCode }: PromotionFormValues) => {
    setBusy("preview");
    setError("");
    setAcknowledged(false);
    try {
      setPreview(await unifiedApi.previewWorkspacePromotion(workspaceId, accountId, promoCode.trim()));
    } catch (reason) {
      setPreview(undefined);
      setError((reason as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  const applyPromotion = async () => {
    if (!preview?.isEligible) return;
    setBusy("apply");
    setError("");
    try {
      const result = await unifiedApi.applyWorkspacePromotion(workspaceId, accountId, preview.promoCode, acknowledged);
      if (!result.verified) {
        productMessage.warning("上游已接受优惠码更新，但回读或本地记录失败，请刷新账单确认");
      } else if (result.renewalEnabled) {
        productMessage.success("优惠码已应用，Workspace 已恢复续费");
      } else {
        productMessage.success("优惠码已应用，订阅状态已回读");
      }
      await onApplied(result);
      onClose();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  const requiresRenewalAcknowledgement = preview?.wouldEnableRenewal === true;
  const canApply = preview?.isEligible === true
    && Boolean(preview.metadata)
    && (!requiresRenewalAcknowledgement || acknowledged);

  return (
    <ProductModal title="更新 Workspace 优惠码" open={open} onCancel={onClose} width={620}>
      <Space direction="vertical" size={16} className="panel-stack">
        <Alert
          type="info"
          showIcon
          message="先校验优惠码，再确认应用到当前 Workspace 订阅。"
          description="应用优惠码属于订阅写操作。若当前已取消续费，上游可能在应用后恢复续费。"
        />
        {error && <Alert type="error" showIcon message={error} />}
        <Form
          form={form}
          layout="vertical"
          onFinish={previewPromotion}
          onValuesChange={() => {
            setPreview(undefined);
            setAcknowledged(false);
            setError("");
          }}
        >
          <Form.Item
            name="promoCode"
            label="优惠码"
            rules={[
              { required: true, whitespace: true, message: "请输入优惠码" },
              { max: 256, message: "优惠码长度不能超过 256 个字符" },
            ]}
          >
            <Input autoComplete="off" placeholder="输入 Workspace 优惠码" />
          </Form.Item>
          <Button htmlType="submit" loading={busy === "preview"} disabled={busy === "apply"}>
            校验优惠码
          </Button>
        </Form>

        {preview && !preview.isEligible && (
          <Alert
            type="error"
            showIcon
            message={preview.ineligibleReason?.title ?? "优惠码不可用"}
            description={[
              preview.ineligibleReason?.message,
              preview.ineligibleReason?.code ? `错误代码：${preview.ineligibleReason.code}` : undefined,
            ].filter(Boolean).join("；")}
          />
        )}

        {preview?.isEligible && preview.metadata && (
          <>
            <Alert
              type="success"
              showIcon
              message={preview.metadata.title || "优惠码可以应用"}
              description={preview.metadata.summary}
            />
            <Descriptions size="small" column={1} bordered items={promotionDetails(preview.metadata, preview)} />
            {requiresRenewalAcknowledgement && (
              <Alert
                type="warning"
                showIcon
                message={preview.subscription.willRenew === false ? "当前 Workspace 已取消续费" : "当前 Workspace 续费状态未知"}
                description="应用此优惠码后，上游可能恢复 Workspace 续费。请确认已了解该订阅变化。"
              />
            )}
            {requiresRenewalAcknowledgement && (
              <Checkbox checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)}>
                我已了解应用优惠码可能恢复续费
              </Checkbox>
            )}
            <Space wrap>
              <Button
                type="primary"
                loading={busy === "apply"}
                disabled={!canApply || busy === "preview"}
                onClick={() => void applyPromotion()}
              >
                {requiresRenewalAcknowledgement ? "确认续费影响并应用" : "应用优惠码"}
              </Button>
              <Typography.Text type="secondary">写入后将自动回读最新订阅状态。</Typography.Text>
            </Space>
          </>
        )}
      </Space>
    </ProductModal>
  );
}

function promotionDetails(metadata: WorkspacePromotionMetadataView, preview: WorkspacePromotionPreviewView) {
  return [
    { key: "plan", label: "适用套餐", children: metadata.planName === "chatgptteamplan" ? "Business" : metadata.planName || "未知" },
    { key: "quantity", label: "优惠席位", children: metadata.quantityOff === undefined ? "未说明" : `${metadata.quantityOff} 个席位` },
    { key: "duration", label: "优惠期限", children: promotionDuration(metadata) },
    { key: "discount-end", label: "优惠结束", children: metadata.noAutoRenewalAtDiscountEnd === undefined ? "未说明" : metadata.noAutoRenewalAtDiscountEnd ? "优惠结束时不自动续费" : "继续按订阅规则续费" },
    { key: "subscription", label: "当前订阅", children: subscriptionText(preview) },
    { key: "renewal", label: "续费影响", children: preview.wouldEnableRenewal ? "应用后可能恢复续费" : "保持当前续费状态" },
  ];
}

function promotionDuration(metadata: WorkspacePromotionMetadataView): string {
  if (metadata.durationPeriods === undefined) return "未说明";
  const unit = metadata.durationPeriod === "month" ? "个月" : metadata.durationPeriod ?? "个周期";
  return metadata.durationPeriod === "month"
    ? `${metadata.durationPeriods}${unit}`
    : `${metadata.durationPeriods} ${unit}`;
}

function subscriptionText(preview: WorkspacePromotionPreviewView): string {
  const value = preview.subscription;
  return [
    value.planType,
    value.seatsEntitled === undefined ? undefined : `${value.seatsInUse ?? 0}/${value.seatsEntitled} 席位`,
    value.billingCurrency,
    value.activeUntil ? `当前周期至 ${formatTime(value.activeUntil)}` : undefined,
  ].filter(Boolean).join(" · ") || "未读取到订阅摘要";
}
