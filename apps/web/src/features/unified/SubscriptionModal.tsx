import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Form, Select } from "antd";
import { ProductModal, useProductMessage } from "../../components/ProductOverlays.js";
import {
  PERSONAL_PLAN_OPTIONS,
  type AutomationOperationView,
  type ChangePersonalSubscriptionRequest,
  type PersonalPlan,
  type PersonalSubscriptionChangePreviewView,
  type UnifiedAccountDetailView,
} from "@team-manager/shared";
import { unifiedApi } from "../../unifiedApi.js";

interface SubscriptionValues {
  targetPlan: ChangePersonalSubscriptionRequest["targetPlan"];
}

const UPGRADE_TARGETS = new Set<string>(["pro_5x", "pro_20x"]);

/** 个人套餐升级：只支持已验证的 Plus → Pro 5x / Pro 20x，使用账号当前默认支付方式立即扣款。 */
export function SubscriptionModal({
  accountId,
  currentPlan,
  open,
  onClose,
  onChanged,
  onOperationCreated,
}: {
  accountId: string;
  currentPlan?: PersonalPlan;
  open: boolean;
  onClose: () => void;
  onChanged?: () => void | Promise<void>;
  onOperationCreated?: (operation: AutomationOperationView) => void;
}) {
  const productMessage = useProductMessage();
  const [form] = Form.useForm<SubscriptionValues>();
  const [busy, setBusy] = useState(false);
  const [loadingAccount, setLoadingAccount] = useState(false);
  const [detail, setDetail] = useState<UnifiedAccountDetailView>();
  const [upgradePreview, setUpgradePreview] = useState<PersonalSubscriptionChangePreviewView>();
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [error, setError] = useState("");
  const targetPlan = Form.useWatch("targetPlan", form) ?? "pro_5x";
  const effectivePersonalPlan = detail?.personalPlan ?? currentPlan ?? "unknown";
  const upgradeable = effectivePersonalPlan === "plus";
  const planOptions = useMemo(
    () => PERSONAL_PLAN_OPTIONS
      .filter((item) => UPGRADE_TARGETS.has(item.plan))
      .map((item) => ({ value: item.plan, label: item.label })),
    [],
  );

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    setError("");
    setDetail(undefined);
    setUpgradePreview(undefined);
    setLoadingAccount(true);
    void unifiedApi
      .account(accountId)
      .then(setDetail)
      .catch((reason) => setError((reason as Error).message))
      .finally(() => setLoadingAccount(false));
  }, [accountId, open]);

  useEffect(() => {
    if (!open || !upgradeable || !UPGRADE_TARGETS.has(targetPlan)) {
      setUpgradePreview(undefined);
      return;
    }
    let active = true;
    setLoadingPreview(true);
    setUpgradePreview(undefined);
    setError("");
    void unifiedApi.previewPersonalSubscriptionChange(accountId, targetPlan)
      .then((value) => { if (active) setUpgradePreview(value); })
      .catch((reason) => { if (active) setError((reason as Error).message); })
      .finally(() => { if (active) setLoadingPreview(false); });
    return () => { active = false; };
  }, [accountId, open, targetPlan, upgradeable]);

  const submit = async (values: SubscriptionValues) => {
    setBusy(true);
    setError("");
    try {
      const operation = await unifiedApi.changePersonalSubscription(accountId, {
        targetPlan: values.targetPlan,
        mode: "change_existing",
        autoPay: true,
      });
      await onChanged?.();
      productMessage.success("套餐已升级");
      onClose();
      onOperationCreated?.(operation);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ProductModal title="升级套餐" open={open} onCancel={onClose} width={680}>
      <Form
        form={form}
        layout="vertical"
        initialValues={{ targetPlan: "pro_5x" }}
        onFinish={submit}
        className="account-action-form"
        disabled={loadingAccount}
      >
        <Alert
          type={upgradeable ? "info" : "warning"}
          showIcon
          message={upgradeable
            ? "当前个人套餐：Plus，可升级到 Pro 5x 或 Pro 20x。"
            : `当前个人套餐：${effectivePersonalPlan}。只支持从 Plus 升级；首次开通与 Business 开通已下线。`}
        />
        <Form.Item name="targetPlan" label="目标套餐" rules={[{ required: true }]}>
          <Select options={planOptions} />
        </Form.Item>
        {upgradeable && (
          <Form.Item>
            <Alert
              type="warning"
              showIcon
              message={loadingPreview
                ? "正在读取上游扣款预览"
                : upgradePreview
                  ? `今日扣款 ${formatMoney(upgradePreview.amountDueMinor, upgradePreview.currency)}，默认支付方式 ${upgradePreview.defaultPaymentMethod?.brand ?? "未知"} *${upgradePreview.defaultPaymentMethod?.last4 ?? "未知"}`
                  : "请选择目标套餐以读取扣款预览"}
              description={upgradePreview
                ? `新套餐费用 ${formatMoney(upgradePreview.positiveLineItemMinor, upgradePreview.currency)}，原套餐按比例抵扣 ${formatMoney(upgradePreview.adjustmentMinor, upgradePreview.currency)}。`
                : undefined}
            />
          </Form.Item>
        )}
        {error && <Alert className="modal-error" type="error" showIcon message={error} />}
        <Button
          type="primary"
          htmlType="submit"
          loading={busy || loadingAccount || loadingPreview}
          disabled={!detail || !upgradeable || !upgradePreview}
        >
          立即升级
        </Button>
      </Form>
    </ProductModal>
  );
}

function formatMoney(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency }).format(amountMinor / 100);
}
