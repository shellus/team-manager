import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Form,
  Input,
  Radio,
  Select,
  Switch,
} from "antd";
import { ProductModal, useProductMessage } from "../../components/ProductOverlays.js";
import {
  PERSONAL_PLAN_OPTIONS,
  type AccountManagerOperationView,
  type BusinessSubscriptionMode,
  type ChangePersonalSubscriptionRequest,
  type OpenBusinessSubscriptionRequest,
  type PaymentCardInput,
  type PersonalPlan,
  type PersonalSubscriptionChangePreviewView,
  type UnifiedAccountDetailView,
} from "@team-manager/shared";
import { unifiedApi } from "../../unifiedApi.js";
import { PaymentCardFields } from "../../components/PaymentCardFields.js";
import { selectUpgradeableWorkspaces } from "./accountActionsModel.js";
import {
  loadSubscriptionDefaults,
  saveSubscriptionDefaults,
} from "./serverFormDefaults.js";

type SubscriptionTarget = "personal" | "business";

interface SubscriptionValues {
  target: SubscriptionTarget;
  targetPlan: ChangePersonalSubscriptionRequest["targetPlan"];
  businessMode: BusinessSubscriptionMode;
  workspaceId?: string;
  country: string;
  currency: string;
  promoEnabled: boolean;
  promoCode?: string;
  autoPay: boolean;
  card?: PaymentCardInput;
}

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
  onOperationCreated?: (operation: AccountManagerOperationView) => void;
}) {
  const productMessage = useProductMessage();
  const [form] = Form.useForm<SubscriptionValues>();
  const [busy, setBusy] = useState(false);
  const [loadingAccount, setLoadingAccount] = useState(false);
  const [loadingDefaults, setLoadingDefaults] = useState(false);
  const [detail, setDetail] = useState<UnifiedAccountDetailView>();
  const [upgradePreview, setUpgradePreview] = useState<PersonalSubscriptionChangePreviewView>();
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [error, setError] = useState("");
  const target = Form.useWatch("target", form) ?? "personal";
  const businessMode =
    Form.useWatch("businessMode", form) ?? "create_workspace";
  const targetPlan = Form.useWatch("targetPlan", form) ?? "plus";
  const promoEnabled = Form.useWatch("promoEnabled", form) === true;
  const effectivePersonalPlan = detail?.personalPlan ?? currentPlan ?? "unknown";
  const isFree = effectivePersonalPlan === "free";
  const isVerifiedPaidUpgrade = effectivePersonalPlan === "plus";
  const personalChangeUnavailable = target === "personal" && !isFree && !isVerifiedPaidUpgrade;
  const personalPlanOptions = useMemo(
    () => PERSONAL_PLAN_OPTIONS
      .filter((item) => isFree || (isVerifiedPaidUpgrade && ["pro_5x", "pro_20x"].includes(item.plan)))
      .map((item) => ({ value: item.plan, label: item.label })),
    [isFree, isVerifiedPaidUpgrade],
  );
  const manageableWorkspaces = useMemo(
    () =>
      selectUpgradeableWorkspaces(detail?.workspaces ?? []),
    [detail],
  );

  useEffect(() => {
    if (!open) return;
    let active = true;
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
    setLoadingDefaults(true);
    void loadSubscriptionDefaults()
      .then((defaults) => {
        if (active) form.setFieldsValue(defaults);
      })
      .catch((reason) => {
        if (active) setError(`读取套餐默认值失败：${(reason as Error).message}`);
      })
      .finally(() => {
        if (active) setLoadingDefaults(false);
      });
    return () => {
      active = false;
    };
  }, [accountId, open]);

  useEffect(() => {
    if (!detail || detail.personalPlan === 'free') return;
    if (detail.personalPlan === 'plus' && !['pro_5x', 'pro_20x'].includes(form.getFieldValue('targetPlan'))) {
      form.setFieldValue('targetPlan', 'pro_5x');
    }
  }, [detail, form]);

  useEffect(() => {
    if (!open || target !== "personal" || !isVerifiedPaidUpgrade || !['pro_5x', 'pro_20x'].includes(targetPlan)) {
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
  }, [accountId, isVerifiedPaidUpgrade, open, target, targetPlan]);

  const initial = useMemo<Partial<SubscriptionValues>>(
    () => ({
      target: "personal",
      targetPlan: "plus",
      businessMode: "create_workspace",
      country: "US",
      currency: "USD",
      promoEnabled: false,
      autoPay: false,
    }),
    [isFree],
  );

  const submit = async (values: SubscriptionValues) => {
    setBusy(true);
    setError("");
    try {
      const common = {
        country: values.country.toUpperCase(),
        currency: values.currency.toUpperCase(),
        autoPay: values.autoPay === true,
        ...(values.promoEnabled && values.promoCode?.trim() ? { promoCode: values.promoCode.trim() } : {}),
        // card 有意不进入表单记忆白名单。
        ...(values.card?.number ? { card: values.card } : {}),
      };
      const personalRequest: ChangePersonalSubscriptionRequest = isFree
        ? {
            ...common,
            targetPlan: values.targetPlan,
            mode: "start_new",
          }
        : {
            country: values.country,
            currency: values.currency,
            autoPay: true,
            targetPlan: values.targetPlan,
            mode: "change_existing",
          };
      const operation =
        values.target === "personal"
          ? await unifiedApi.changePersonalSubscription(accountId, personalRequest)
          : await unifiedApi.openBusiness(accountId, {
              ...common,
              mode: values.businessMode,
              ...(values.businessMode === "upgrade_existing_workspace"
                ? { workspaceId: values.workspaceId }
                : {}),
            } satisfies OpenBusinessSubscriptionRequest);
      if (values.target === "business" || isFree) {
        try {
          await saveSubscriptionDefaults({
            promoEnabled: values.promoEnabled === true,
            promoCode: values.promoCode,
          });
        } catch (reason) {
          productMessage.warning(`套餐操作已创建，但保存优惠码默认值失败：${(reason as Error).message}`);
        }
      }
      await onChanged?.();
      productMessage.success("套餐操作已创建");
      onClose();
      onOperationCreated?.(operation);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ProductModal
      title={isFree ? "开通套餐" : "升级套餐"}
      open={open}
      onCancel={onClose}
      width={680}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={initial}
        onFinish={submit}
        className="account-action-form"
        disabled={loadingAccount || loadingDefaults}
      >
        <Form.Item name="target" label="套餐类型">
          <Radio.Group
            optionType="button"
            buttonStyle="solid"
            options={[
              { label: "个人套餐", value: "personal" },
              { label: "Business", value: "business" },
            ]}
          />
        </Form.Item>

        {target === "personal" ? (
          <>
            <Alert
              type={personalChangeUnavailable ? "warning" : "info"}
              showIcon
              message={personalChangeUnavailable
                ? `当前个人套餐：${effectivePersonalPlan}。该套餐的付费变更协议尚未验证。`
                : isFree
                  ? "当前个人套餐：Free，可全新开通。"
                  : "当前个人套餐：Plus，可升级到 Pro 5x 或 Pro 20x。"}
            />
            <Form.Item
              name="targetPlan"
              label="目标套餐"
              rules={[{ required: true }]}
            >
              <Select
                options={personalPlanOptions}
              />
            </Form.Item>
            {!isFree && isVerifiedPaidUpgrade && (
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
          </>
        ) : (
          <>
            <Form.Item
              name="businessMode"
              label="操作方式"
              rules={[{ required: true }]}
            >
              <Radio.Group
                options={[
                  { label: "创建新 Workspace", value: "create_workspace" },
                  {
                    label: "升级已有 Workspace",
                    value: "upgrade_existing_workspace",
                  },
                ]}
              />
            </Form.Item>
            {businessMode === "upgrade_existing_workspace" && (
              <Form.Item
                name="workspaceId"
                label="可管理 Workspace"
                rules={[{ required: true, message: "请选择要升级的 Workspace" }]}
              >
                <Select
                  loading={loadingAccount}
                  placeholder={
                    manageableWorkspaces.length
                      ? "选择 Workspace"
                      : "没有可升级的 Workspace"
                  }
                  options={manageableWorkspaces.map((workspace) => ({
                    value: workspace.id,
                    label: workspace.name ?? workspace.externalId,
                  }))}
                />
              </Form.Item>
            )}
          </>
        )}

        {(target === "business" || isFree) && <><div className="responsive-form-grid">
          <Form.Item
            name="country"
            label="国家"
            rules={[{ required: true, pattern: /^[A-Za-z]{2}$/ }]}
          >
            <Input maxLength={2} />
          </Form.Item>
          <Form.Item
            name="currency"
            label="货币"
            rules={[{ required: true, pattern: /^[A-Za-z]{3}$/ }]}
          >
            <Input maxLength={3} />
          </Form.Item>
        </div>
        <Form.Item name="promoEnabled" label="使用优惠码" valuePropName="checked">
          <Switch />
        </Form.Item>
        {promoEnabled && <Form.Item
          name="promoCode"
          label="优惠码"
          rules={[{ required: true, message: "请输入优惠码" }]}
        >
          <Input />
        </Form.Item>}
        <Form.Item name="autoPay" label="自动提交付款" valuePropName="checked">
          <Switch />
        </Form.Item>
        <details className="optional-fields">
          <summary>使用新支付卡（可选）</summary>
          <PaymentCardFields prefix="card" />
        </details>
        </>}
        {error && <Alert className="modal-error" type="error" showIcon message={error} />}
        <Button
          type="primary"
          htmlType="submit"
          loading={busy || loadingAccount || loadingDefaults || loadingPreview}
          disabled={!detail || personalChangeUnavailable || (!isFree && target === "personal" && !upgradePreview)}
        >
          {!isFree && target === "personal" ? "立即升级" : "创建套餐操作"}
        </Button>
      </Form>
    </ProductModal>
  );
}

function formatMoney(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency }).format(amountMinor / 100);
}
