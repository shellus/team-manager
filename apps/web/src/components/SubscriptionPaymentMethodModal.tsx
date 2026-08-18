import { useEffect, useRef, useState } from "react";
import { Alert, Button, Descriptions, Form, Input } from "antd";
import type {
  AddSubscriptionPaymentMethodRequest,
  PaymentMethodDefaults,
} from "@team-manager/shared";
import { PaymentCardFields } from "./PaymentCardFields.js";
import { ProductModal } from "./ProductOverlays.js";

export function SubscriptionPaymentMethodModal({
  targetLabel,
  open,
  busy,
  loadDefaults,
  onClose,
  onSubmit,
}: {
  targetLabel: string;
  open: boolean;
  busy: boolean;
  loadDefaults: () => Promise<PaymentMethodDefaults>;
  onClose: () => void;
  onSubmit: (value: AddSubscriptionPaymentMethodRequest) => Promise<void>;
}) {
  const [form] = Form.useForm<AddSubscriptionPaymentMethodRequest>();
  const [defaultsLoading, setDefaultsLoading] = useState(false);
  const [defaultsError, setDefaultsError] = useState("");
  const [region, setRegion] = useState("");
  const loadDefaultsRef = useRef(loadDefaults);

  useEffect(() => {
    loadDefaultsRef.current = loadDefaults;
  }, [loadDefaults]);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    setRegion("");
    setDefaultsLoading(true);
    setDefaultsError("");
    void loadDefaultsRef.current()
      .then((value) => {
        form.setFieldsValue({
          holderName: value.holderName,
          postalCode: value.postalCode,
        });
        setRegion(value.region);
      })
      .catch((reason) => setDefaultsError((reason as Error).message))
      .finally(() => setDefaultsLoading(false));
  }, [form, open]);

  return (
    <ProductModal
      title={`绑定${targetLabel}支付方式`}
      open={open}
      onCancel={onClose}
    >
      <Alert
        type="info"
        showIcon
        message={`卡片将绑定到${targetLabel}，完整卡号和 CVC 只在本次请求中发送给 Stripe。`}
      />
      {region && (
        <Descriptions
          size="small"
          column={1}
          items={[{ key: "region", label: "默认账单地区", children: region }]}
        />
      )}
      <Form
        form={form}
        layout="vertical"
        onFinish={onSubmit}
      >
        <div className="responsive-form-grid">
          <Form.Item name="holderName" label="持卡人姓名" rules={[{ required: true }]}>
            <Input autoComplete="cc-name" maxLength={200} />
          </Form.Item>
          <Form.Item name="postalCode" label="账单邮编" rules={[{ required: true }]}>
            <Input autoComplete="postal-code" maxLength={32} />
          </Form.Item>
        </div>
        <PaymentCardFields prefix="card" quickInput />
        {defaultsError && (
          <Alert
            className="modal-error"
            type="warning"
            showIcon
            message={`默认账单资料读取失败：${defaultsError}`}
          />
        )}
        <Button type="primary" htmlType="submit" loading={busy || defaultsLoading}>
          绑定支付方式
        </Button>
      </Form>
    </ProductModal>
  );
}
