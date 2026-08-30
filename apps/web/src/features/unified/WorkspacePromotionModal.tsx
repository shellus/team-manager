import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Checkbox, Descriptions, Form, Input, Select, Space, Typography } from "antd";
import type {
  AccountWorkspaceLinkView,
  WorkspacePromotionApplyResultView,
  WorkspacePromotionMetadataView,
  PromotionLookupView,
} from "@team-manager/shared";
import { ProductModal, useProductMessage } from "../../components/ProductOverlays.js";
import { formatTime } from "../../components/ProductPrimitives.js";
import { unifiedApi } from "../../unifiedApi.js";

interface PromotionFormValues {
  promoCode: string;
}

export function WorkspacePromotionModal({
  accountId,
  workspaces,
  selectedWorkspaceId,
  open,
  onClose,
  onApplied,
}: {
  accountId: string;
  workspaces: AccountWorkspaceLinkView[];
  selectedWorkspaceId?: string;
  open: boolean;
  onClose: () => void;
  onApplied: (result: WorkspacePromotionApplyResultView) => Promise<void>;
}) {
  const productMessage = useProductMessage();
  const [form] = Form.useForm<PromotionFormValues>();
  const [preview, setPreview] = useState<PromotionLookupView>();
  const manageableWorkspaces = useMemo(
    () => workspaces.filter((workspace) => workspace.manageable && workspace.membershipStatus === "active"),
    [workspaces],
  );
  const [target, setTarget] = useState<{ kind: "personal" | "workspace"; workspaceId?: string }>({ kind: "personal" });
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState<"preview" | "apply">();
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      const defaultWorkspace = manageableWorkspaces.find((item) => item.id === selectedWorkspaceId) ?? manageableWorkspaces[0];
      setTarget(defaultWorkspace ? { kind: "workspace", workspaceId: defaultWorkspace.id } : { kind: "personal" });
      return;
    }
    form.resetFields();
    setPreview(undefined);
    setAcknowledged(false);
    setBusy(undefined);
    setError("");
  }, [form, manageableWorkspaces, open, selectedWorkspaceId]);

  const previewPromotion = async ({ promoCode }: PromotionFormValues) => {
    setBusy("preview");
    setError("");
    setAcknowledged(false);
    try {
      setPreview(await unifiedApi.lookupPromotion(accountId, target, promoCode.trim()));
    } catch (reason) {
      setPreview(undefined);
      setError((reason as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  const applyPromotion = async () => {
    if (!preview?.isEligible || preview.target.kind !== "workspace" || !preview.target.workspaceId) return;
    setBusy("apply");
    setError("");
    try {
      const result = await unifiedApi.applyWorkspacePromotion(preview.target.workspaceId, accountId, preview.promoCode, acknowledged);
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

  const requiresRenewalAcknowledgement = preview?.wouldEnableRenewal === true && preview.target.kind === "workspace";
  const isBusinessWorkspacePromotion = preview?.metadata?.planName === "chatgptteamplan";
  const canApply = preview?.isEligible === true && preview.target.kind === "workspace"
    && isBusinessWorkspacePromotion
    && (!requiresRenewalAcknowledgement || acknowledged);

  return (
    <ProductModal title="查询 / 更新优惠码" open={open} onCancel={onClose} width={620}>
      <Space direction="vertical" size={16} className="panel-stack">
        <Alert
          type="info"
          showIcon
          message="先选择目标空间，再校验优惠码。"
          description="优惠码结果绑定 chatgpt-account-id；不同 Workspace 和个人空间可能返回不同结果。个人空间只支持查询，不会写入 Workspace 订阅。"
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
          <Form.Item label="查询上下文">
            <Select
              value={target.kind === "personal" ? "personal" : `workspace:${target.workspaceId}`}
              onChange={(value: string) => {
                if (value === "personal") setTarget({ kind: "personal" });
                else setTarget({ kind: "workspace", workspaceId: value.slice("workspace:".length) });
                setPreview(undefined);
                setAcknowledged(false);
                setError("");
              }}
              options={[
                { value: "personal", label: "个人空间" },
                ...manageableWorkspaces.map((workspace) => ({
                  value: `workspace:${workspace.id}`,
                  label: `${workspace.name ?? workspace.externalId} · ${workspace.role}`,
                })),
              ]}
            />
          </Form.Item>
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
              message={preview.metadata.title || `优惠码可用 · ${preview.targetLabel}`}
              description={preview.metadata.summary}
            />
            <Descriptions size="small" column={1} bordered items={promotionDetails(preview.metadata, preview)} />
            {preview.target.kind === "workspace" && !isBusinessWorkspacePromotion && (
              <Alert type="warning" showIcon message="该优惠码不是 Business Workspace 优惠码" description="当前仅展示上游返回的信息，不会提供应用入口。" />
            )}
            {requiresRenewalAcknowledgement && (
              <Alert
                type="warning"
                showIcon
                message={preview.subscription?.willRenew === false ? "当前 Workspace 已取消续费" : "当前 Workspace 续费状态未知"}
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
              <Typography.Text type="secondary">
                {preview.target.kind === "personal" ? "个人空间只读查询，不能在此应用。" : "写入后将自动回读最新订阅状态。"}
              </Typography.Text>
            </Space>
          </>
        )}
      </Space>
    </ProductModal>
  );
}

export function promotionDetails(metadata: WorkspacePromotionMetadataView, preview: PromotionLookupView) {
  const discountRows = promotionDiscountRows(metadata);
  return [
    ...discountRows,
    { key: "plan", label: "适用套餐", children: metadata.planName === "chatgptteamplan" ? "Business" : metadata.planName || "未知" },
    { key: "duration", label: "优惠期限", children: promotionDuration(metadata) },
    { key: "promotion-type", label: "优惠类型", children: promotionTypeText(metadata) },
    { key: "price-period", label: "生效方式", children: pricePeriodText(metadata.pricePeriod) },
    { key: "discount-end", label: "优惠结束", children: metadata.noAutoRenewalAtDiscountEnd === undefined ? "未说明" : metadata.noAutoRenewalAtDiscountEnd ? "优惠结束时不自动续费" : "继续按订阅规则续费" },
    { key: "subscription", label: "当前订阅", children: subscriptionText(preview) },
    { key: "renewal", label: "续费影响", children: preview.wouldEnableRenewal ? "应用后可能恢复续费" : "保持当前续费状态" },
    { key: "processor", label: "支付处理方", children: processorText(metadata.processor) },
  ];
}

function promotionDiscountRows(metadata: WorkspacePromotionMetadataView) {
  const rows = [];
  if (metadata.discountValue !== undefined) {
    rows.push({
      key: "amount",
      label: "优惠金额",
      children: <Typography.Text strong>{promotionDiscountText(metadata.discountValue, metadata.discountCurrency)}</Typography.Text>,
    });
  }
  if (metadata.quantityOff !== undefined) {
    rows.push({
      key: "quantity",
      label: "优惠席位",
      children: <Typography.Text strong>{`${metadata.quantityOff} 个席位`}</Typography.Text>,
    });
  }
  return rows.length > 0 ? rows : [{ key: "discount", label: "优惠内容", children: "上游未说明" }];
}

export function promotionDiscountText(value: number, currency?: string): string {
  if (!currency) return `${value}（币种未说明）`;
  const normalized = currency.toUpperCase();
  try {
    const amount = new Intl.NumberFormat("zh-CN", { style: "currency", currency: normalized }).format(value);
    return `${amount}（${normalized}）`;
  } catch {
    return `${value} ${normalized}`;
  }
}

function promotionTypeText(metadata: WorkspacePromotionMetadataView): string {
  if (metadata.discountValue !== undefined) return "固定金额减免";
  if (metadata.quantityOff !== undefined) return "按席位减免";
  return metadata.promotionType === "discount" ? "折扣" : metadata.promotionType || "未说明";
}

function pricePeriodText(value?: string): string {
  if (value === "recurring") return "每个账期重复生效";
  return value || "未说明";
}

function processorText(value?: string): string {
  if (value?.toLowerCase() === "stripe") return "Stripe";
  return value || "未说明";
}

function promotionDuration(metadata: WorkspacePromotionMetadataView): string {
  if (metadata.durationPeriods === undefined) return "未说明";
  const unit = metadata.durationPeriod === "month" ? "个月" : metadata.durationPeriod ?? "个周期";
  return metadata.durationPeriod === "month"
    ? `${metadata.durationPeriods}${unit}`
    : `${metadata.durationPeriods} ${unit}`;
}

function subscriptionText(preview: PromotionLookupView): string {
  const value = preview.subscription;
  if (!value) return "未读取到订阅摘要";
  return [
    value.planType,
    value.seatsEntitled === undefined ? undefined : `${value.seatsInUse ?? 0}/${value.seatsEntitled} 席位`,
    value.billingCurrency,
    value.activeUntil ? `当前周期至 ${formatTime(value.activeUntil)}` : undefined,
  ].filter(Boolean).join(" · ") || "未读取到订阅摘要";
}
