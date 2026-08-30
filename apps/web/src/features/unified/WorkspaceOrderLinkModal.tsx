import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Radio,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import { CopyOutlined, ExportOutlined } from "@ant-design/icons";
import type {
  AccountWorkspaceLinkView,
  GenerateWorkspaceOrderLinkRequest,
  WorkspaceOrderLinkMode,
  WorkspaceOrderLinkView,
  SeatType,
  PromotionLookupView,
} from "@team-manager/shared";
import { ProductModal, useProductMessage } from "../../components/ProductOverlays.js";
import { formatTime } from "../../components/ProductPrimitives.js";
import { formatMoney } from "../../components/OperationalDataPanels.js";
import { CHECKOUT_COUNTRY_OPTIONS, CHECKOUT_CURRENCY_OPTIONS } from "../../components/selectOptions.js";
import { unifiedApi } from "../../unifiedApi.js";
import { errorMessage } from "../../api.js";
import { SEAT_LABEL } from "../../labels.js";
import { promotionDetails } from "./WorkspacePromotionModal.js";

interface WorkspaceOrderLinkValues {
  workspaceId?: string;
  workspaceName?: string;
  country: string;
  currency: string;
  defaultSeats: number;
  proliteSeats: number;
  promoCode?: string;
}

export function WorkspaceOrderLinkModal({
  accountId,
  accountEmail,
  workspaces,
  selectedWorkspaceId,
  mode,
  open,
  onModeChange,
  onClose,
  onGenerated,
}: {
  accountId: string;
  accountEmail: string;
  workspaces: AccountWorkspaceLinkView[];
  selectedWorkspaceId?: string;
  mode: WorkspaceOrderLinkMode;
  open: boolean;
  onModeChange: (mode: WorkspaceOrderLinkMode) => void;
  onClose: () => void;
  onGenerated?: () => void | Promise<void>;
}) {
  const productMessage = useProductMessage();
  const [form] = Form.useForm<WorkspaceOrderLinkValues>();
  const [busy, setBusy] = useState(false);
  const [promotionBusy, setPromotionBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<WorkspaceOrderLinkView>();
  const [promotionLookup, setPromotionLookup] = useState<PromotionLookupView>();
  const manageableWorkspaces = useMemo(
    () => workspaces.filter((workspace) => workspace.manageable && workspace.membershipStatus === "active"),
    [workspaces],
  );
  const defaultWorkspaceId = manageableWorkspaces.some((workspace) => workspace.id === selectedWorkspaceId)
    ? selectedWorkspaceId
    : manageableWorkspaces[0]?.id;
  const selectedOrderWorkspaceId = Form.useWatch("workspaceId", form);
  const selectedOrderWorkspace = manageableWorkspaces.find((workspace) => workspace.id === selectedOrderWorkspaceId);

  useEffect(() => {
    if (!open) return;
    setError("");
    setResult(undefined);
    setPromotionLookup(undefined);
    form.resetFields();
    form.setFieldsValue({
      country: "US",
      currency: "USD",
      defaultSeats: 2,
      proliteSeats: 0,
      workspaceId: defaultWorkspaceId,
    });
  }, [accountId, defaultWorkspaceId, form, open]);

  const changeMode = (nextMode: WorkspaceOrderLinkMode) => {
    setError("");
    setResult(undefined);
    setPromotionLookup(undefined);
    if (nextMode === "upgrade_existing_workspace" && !form.getFieldValue("workspaceId")) {
      form.setFieldValue("workspaceId", defaultWorkspaceId);
    }
    onModeChange(nextMode);
  };

  const lookupPromotion = async () => {
    const promoCode = String(form.getFieldValue("promoCode") ?? "").trim();
    if (!promoCode) {
      setError("请输入优惠码后再检查");
      return;
    }
    if (mode === "upgrade_existing_workspace" && !selectedOrderWorkspaceId) {
      setError("请先选择要升级的 Workspace");
      return;
    }
    setPromotionBusy(true);
    setError("");
    setPromotionLookup(undefined);
    try {
      const target = mode === "create_workspace"
        ? { kind: "personal" as const }
        : { kind: "workspace" as const, workspaceId: selectedOrderWorkspaceId };
      setPromotionLookup(await unifiedApi.lookupPromotion(accountId, target, promoCode));
    } catch (reason) {
      setError(errorMessage(reason, "优惠码检查失败"));
    } finally {
      setPromotionBusy(false);
    }
  };

  const submit = async (values: WorkspaceOrderLinkValues) => {
    setBusy(true);
    setError("");
    setResult(undefined);
    try {
      const seatQuantities = seatQuantityRows(values);
      const seatQuantity = seatQuantities.reduce((sum, item) => sum + item.quantity, 0);
      const request: GenerateWorkspaceOrderLinkRequest = {
        mode,
        country: values.country,
        currency: values.currency,
        seatQuantity,
        seatQuantities,
        ...(values.promoCode?.trim() ? { promoCode: values.promoCode.trim() } : {}),
        ...(mode === "upgrade_existing_workspace"
          ? { workspaceId: values.workspaceId }
          : { workspaceName: values.workspaceName?.trim() }),
      };
      const next = await unifiedApi.generateWorkspaceOrderLink(accountId, request);
      setResult(next);
      productMessage.success("Workspace 订单链接已生成");
      await onGenerated?.();
    } catch (reason) {
      setError(errorMessage(reason, "Workspace 订单链接生成失败"));
    } finally {
      setBusy(false);
    }
  };

  const copyCheckoutUrl = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.checkoutUrl);
      productMessage.success("付款链接已复制");
    } catch {
      productMessage.error("复制失败，请手动选择链接文本复制");
    }
  };

  return (
    <ProductModal
      title="生成 Workspace 订单链接"
      open={open}
      onCancel={onClose}
      width={720}
    >
      <Space direction="vertical" size={16} className="panel-stack">
        <Alert
          type="info"
          showIcon
          message="这里只生成付款链接，不会自动扣款"
          description={`订单使用 ${accountEmail} 的个人态 Session 发起，完成付款后才会创建或升级 Workspace。`}
        />
        <Radio.Group
          optionType="button"
          buttonStyle="solid"
          value={mode}
          disabled={busy}
          onChange={(event) => changeMode(event.target.value as WorkspaceOrderLinkMode)}
          options={[
            { label: "新开 Workspace", value: "create_workspace" },
            { label: "升级已有 Workspace", value: "upgrade_existing_workspace" },
          ]}
        />
        <Form
          form={form}
          layout="vertical"
          onFinish={submit}
          disabled={busy}
          className="workspace-order-link-form"
          onValuesChange={() => setPromotionLookup(undefined)}
        >
          {mode === "create_workspace" ? (
            <Form.Item
              name="workspaceName"
              label="新 Workspace 名称"
              rules={[
                { required: true, whitespace: true, message: "请输入新 Workspace 名称" },
                { max: 128, message: "Workspace 名称不能超过 128 个字符" },
              ]}
            >
              <Input placeholder="例如：Shellus Team" autoComplete="off" />
            </Form.Item>
          ) : (
            <>
              <Form.Item
                name="workspaceId"
                label="要升级的 Workspace"
                rules={[{ required: true, message: "请选择要升级的 Workspace" }]}
              >
                <Select
                  showSearch
                  optionFilterProp="label"
                  placeholder={manageableWorkspaces.length ? "选择 Workspace" : "当前账号没有可管理的 Workspace"}
                  options={manageableWorkspaces.map((workspace) => ({
                    value: workspace.id,
                    label: workspace.name ?? workspace.externalId,
                  }))}
                />
              </Form.Item>
              {selectedOrderWorkspace && (
                <Typography.Paragraph type="secondary" className="workspace-order-target-id">
                  目标 Workspace ID：<Typography.Text copyable code>{selectedOrderWorkspace.externalId}</Typography.Text>
                </Typography.Paragraph>
              )}
            </>
          )}
          <div className="responsive-form-grid">
            <Form.Item name="country" label="账单国家" rules={[{ required: true, message: "请选择账单国家" }]}>
              <Select showSearch options={CHECKOUT_COUNTRY_OPTIONS} />
            </Form.Item>
            <Form.Item name="currency" label="账单货币" rules={[{ required: true, message: "请选择账单货币" }]}>
              <Select showSearch options={CHECKOUT_CURRENCY_OPTIONS} />
            </Form.Item>
            <Form.Item name="defaultSeats" label={SEAT_LABEL.default} rules={[{ required: true, message: "请输入 ChatGPT 席位数" }]}>
              <InputNumber min={0} precision={0} className="panel-stack" />
            </Form.Item>
            <Form.Item name="proliteSeats" label={SEAT_LABEL.prolite} rules={[{ required: true, message: "请输入 Premium 席位数" }]}>
              <InputNumber min={0} precision={0} className="panel-stack" />
            </Form.Item>
            <Form.Item name="promoCode" label="优惠码（可选）">
              <Space.Compact block>
                <Input allowClear maxLength={256} autoComplete="off" placeholder="可先检查，不会创建订单" />
                <Button
                  onClick={() => void lookupPromotion()}
                  loading={promotionBusy}
                  disabled={busy}
                >
                  检查优惠码
                </Button>
              </Space.Compact>
            </Form.Item>
          </div>
          {error && <Alert className="modal-error" type="error" showIcon message={error} />}
          {promotionLookup && (
            <Space direction="vertical" size={8} className="panel-stack">
              <Alert
                type={promotionLookup.isEligible ? "success" : "error"}
                showIcon
                message={promotionLookup.isEligible ? `优惠码可用 · ${promotionLookup.targetLabel}` : (promotionLookup.ineligibleReason?.title ?? "优惠码不可用")}
                description={promotionLookup.isEligible
                  ? promotionLookup.metadata?.summary || "上游已返回可用结果，尚未创建订单。"
                  : [promotionLookup.ineligibleReason?.message, promotionLookup.ineligibleReason?.code ? `错误代码：${promotionLookup.ineligibleReason.code}` : undefined].filter(Boolean).join("；") || "上游返回该优惠码当前不可用。"}
              />
              {promotionLookup.isEligible && promotionLookup.metadata && (
                <Descriptions
                  size="small"
                  bordered
                  column={1}
                  items={promotionDetails(promotionLookup.metadata, promotionLookup)}
                />
              )}
            </Space>
          )}
          <Button
            type="primary"
            htmlType="submit"
            loading={busy}
            disabled={mode === "upgrade_existing_workspace" && manageableWorkspaces.length === 0}
          >
            {mode === "create_workspace" ? "生成开通订单链接" : "生成升级订单链接"}
          </Button>
        </Form>

        {result && (
          <section className="workspace-order-link-result" aria-live="polite">
            <Typography.Title level={5}>订单信息</Typography.Title>
            <Descriptions
              size="small"
              bordered
              column={{ xs: 1, sm: 2 }}
              items={orderDescriptionItems(result)}
            />
            <Typography.Text strong>付款链接</Typography.Text>
            <Input.TextArea
              value={result.checkoutUrl}
              readOnly
              autoSize={{ minRows: 3, maxRows: 6 }}
              className="workspace-order-link-url"
              aria-label="Workspace 订单付款链接"
            />
            <Space wrap>
              <Button icon={<CopyOutlined />} onClick={() => void copyCheckoutUrl()}>复制付款链接</Button>
              <Button
                type="primary"
                icon={<ExportOutlined />}
                href={result.checkoutUrl}
                target="_blank"
                rel="noreferrer"
              >
                打开付款页
              </Button>
            </Space>
          </section>
        )}
      </Space>
    </ProductModal>
  );
}

function orderDescriptionItems(result: WorkspaceOrderLinkView) {
  const binding = result.workspaceBindingStatus === "new_workspace"
    ? <Tag color="blue">付款后创建新空间</Tag>
    : result.workspaceBindingStatus === "matched"
      ? <Space size={4} wrap><Tag color="green">目标一致</Tag><Typography.Text code>{result.actualWorkspaceId ?? result.requestedWorkspaceId}</Typography.Text></Space>
      : <Space size={4} wrap><Tag color="gold">订单未返回绑定 ID</Tag><Typography.Text code>{result.requestedWorkspaceId}</Typography.Text></Space>;
  return [
    { key: "mode", label: "订单类型", children: result.mode === "create_workspace" ? "新开 Workspace" : "升级 Workspace" },
    { key: "workspace", label: "Workspace", children: result.workspaceName },
    { key: "binding", label: "订单绑定空间", span: 2, children: binding },
    { key: "quantity", label: "席位数", children: <Space direction="vertical" size={0}><span>{result.orderSeatQuantity === result.requestedSeatQuantity ? `${result.orderSeatQuantity}` : `${result.orderSeatQuantity}（请求 ${result.requestedSeatQuantity}）`}</span>{result.seatQuantities?.map((item) => <Typography.Text key={item.seatType} type="secondary">{SEAT_LABEL[item.seatType]}：{item.quantity}</Typography.Text>)}</Space> },
    { key: "country", label: "国家 / 货币", children: `${result.country} / ${result.currency}` },
    { key: "subtotal", label: "原价", children: formatMoney(result.subtotalMinor, result.currency) },
    { key: "discount", label: "优惠", children: formatMoney(result.discountMinor, result.currency) },
    { key: "tax", label: "税费", children: formatMoney(result.taxMinor, result.currency) },
    { key: "total", label: "应付金额", children: <Typography.Text strong>{formatMoney(result.totalMinor, result.currency)}</Typography.Text> },
    { key: "status", label: "Checkout / 支付", children: `${result.checkoutStatus ?? "未知"} / ${result.paymentStatus ?? "未知"}` },
    { key: "taxStatus", label: "自动税费", children: result.automaticTaxStatus ?? "未知" },
    { key: "created", label: "创建时间", children: formatTime(result.createdAt) },
    { key: "expires", label: "失效时间", children: formatTime(result.expiresAt) },
  ];
}

function seatQuantityRows(values: WorkspaceOrderLinkValues): Array<{ seatType: SeatType; quantity: number }> {
  return [
    { seatType: "default", quantity: Number(values.defaultSeats) || 0 },
    { seatType: "prolite", quantity: Number(values.proliteSeats) || 0 },
  ];
}
