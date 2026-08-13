import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Radio,
  Select,
  Switch,
  message,
} from "antd";
import {
  PERSONAL_PLAN_OPTIONS,
  type AccountManagerOperationView,
  type BusinessSubscriptionMode,
  type ChangePersonalSubscriptionRequest,
  type OpenBusinessSubscriptionRequest,
  type PaymentCardInput,
  type PersonalPlan,
  type PersonalSubscriptionMode,
  type UnifiedAccountDetailView,
} from "@team-manager/shared";
import { unifiedApi } from "../../unifiedApi.js";
import { PaymentCardFields } from "../../components/PaymentCardFields.js";
import { useRememberedForm } from "../../webPreferences.js";
import { selectUpgradeableWorkspaces } from "./accountActionsModel.js";

type SubscriptionTarget = "personal" | "business";

interface SubscriptionValues {
  target: SubscriptionTarget;
  personalMode: PersonalSubscriptionMode;
  targetPlan: ChangePersonalSubscriptionRequest["targetPlan"];
  businessMode: BusinessSubscriptionMode;
  workspaceId?: string;
  country: string;
  currency: string;
  promoCode?: string;
  autoPay: boolean;
  card?: PaymentCardInput;
}

const REMEMBERED_SUBSCRIPTION_FIELDS: readonly (keyof SubscriptionValues)[] = [
  "target",
  "personalMode",
  "targetPlan",
  "businessMode",
  "workspaceId",
  "country",
  "currency",
  "promoCode",
  "autoPay",
];

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
  const [form] = Form.useForm<SubscriptionValues>();
  const remember = useRememberedForm(
    form,
    "account-subscription",
    REMEMBERED_SUBSCRIPTION_FIELDS,
  );
  const [busy, setBusy] = useState(false);
  const [loadingAccount, setLoadingAccount] = useState(false);
  const [detail, setDetail] = useState<UnifiedAccountDetailView>();
  const [error, setError] = useState("");
  const target = Form.useWatch("target", form) ?? "personal";
  const businessMode =
    Form.useWatch("businessMode", form) ?? "create_workspace";
  const effectivePersonalPlan = detail?.personalPlan ?? currentPlan ?? "unknown";
  const isFree = effectivePersonalPlan === "free";
  const manageableWorkspaces = useMemo(
    () =>
      selectUpgradeableWorkspaces(detail?.workspaces ?? []),
    [detail],
  );

  useEffect(() => {
    if (!open) return;
    setError("");
    setDetail(undefined);
    setLoadingAccount(true);
    void unifiedApi
      .account(accountId)
      .then(setDetail)
      .catch((reason) => setError((reason as Error).message))
      .finally(() => setLoadingAccount(false));
  }, [accountId, open]);

  const initial = useMemo<Partial<SubscriptionValues>>(
    () => ({
      target: "personal",
      personalMode: isFree ? "start_new" : "change_existing",
      targetPlan: "plus",
      businessMode: "create_workspace",
      country: "US",
      currency: "USD",
      autoPay: false,
    }),
    [isFree],
  );

  const submit = async (values: SubscriptionValues) => {
    remember(values);
    setBusy(true);
    setError("");
    try {
      const common = {
        country: values.country.toUpperCase(),
        currency: values.currency.toUpperCase(),
        autoPay: values.autoPay === true,
        ...(values.promoCode ? { promoCode: values.promoCode } : {}),
        // card 有意不进入表单记忆白名单。
        ...(values.card?.number ? { card: values.card } : {}),
      };
      const operation =
        values.target === "personal"
          ? await unifiedApi.changePersonalSubscription(accountId, {
              ...common,
              targetPlan: values.targetPlan,
              mode: values.personalMode,
            })
          : await unifiedApi.openBusiness(accountId, {
              ...common,
              mode: values.businessMode,
              ...(values.businessMode === "upgrade_existing_workspace"
                ? { workspaceId: values.workspaceId }
                : {}),
            } satisfies OpenBusinessSubscriptionRequest);
      await onChanged?.();
      message.success("套餐操作已创建");
      onClose();
      onOperationCreated?.(operation);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="开通套餐"
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
      width={680}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={initial}
        onFinish={submit}
        className="account-action-form"
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
              type="info"
              showIcon
              message={`当前个人套餐：${effectivePersonalPlan === "free" ? "Free" : effectivePersonalPlan}`}
            />
            <Form.Item
              name="personalMode"
              label="操作方式"
              rules={[{ required: true }]}
            >
              <Radio.Group
                options={[
                  { label: "全新开通", value: "start_new" },
                  { label: "升级或变更", value: "change_existing" },
                ]}
              />
            </Form.Item>
            <Form.Item
              name="targetPlan"
              label="目标套餐"
              rules={[{ required: true }]}
            >
              <Select
                options={PERSONAL_PLAN_OPTIONS.map((item) => ({
                  value: item.plan,
                  label: item.label,
                }))}
              />
            </Form.Item>
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

        <div className="responsive-form-grid">
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
        <Form.Item name="promoCode" label="优惠码">
          <Input />
        </Form.Item>
        <Form.Item name="autoPay" label="自动提交付款" valuePropName="checked">
          <Switch />
        </Form.Item>
        <details className="raw-debug">
          <summary>使用新支付卡（可选）</summary>
          <PaymentCardFields prefix="card" />
        </details>
        {error && <Alert className="modal-error" type="error" showIcon message={error} />}
        <Button type="primary" htmlType="submit" loading={busy}>
          创建套餐操作
        </Button>
      </Form>
    </Modal>
  );
}
