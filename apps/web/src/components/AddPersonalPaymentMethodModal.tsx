import type { AddPersonalPaymentMethodRequest, PersonalPaymentMethodDefaults } from '@team-manager/shared';
import { Alert, Form, Input, Modal, Space, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { parseCardExpiry } from './cardExpiry.js';
import { ModalErrorAlert } from './ModalErrorAlert.js';
import { PaymentCardFields } from './PaymentCardFields.js';

interface FormValues {
  holderName: string;
  postalCode: string;
  cardQuickInput?: string;
  number?: string;
  expiry?: string;
  cvc?: string;
}

export function AddPersonalPaymentMethodModal({
  open, accountLabel, confirmLoading, error, loadDefaults, onCancel, onSubmit
}: {
  open: boolean;
  accountLabel: string;
  confirmLoading: boolean;
  error: string;
  loadDefaults: () => Promise<PersonalPaymentMethodDefaults>;
  onCancel: () => void;
  onSubmit: (payload: AddPersonalPaymentMethodRequest) => void | Promise<void>;
}) {
  const [form] = Form.useForm<FormValues>();
  const [defaultsLoading, setDefaultsLoading] = useState(false);
  const [defaultsError, setDefaultsError] = useState('');
  const [region, setRegion] = useState('US-OR');
  useEffect(() => {
    if (!open) return;
    let active = true;
    form.resetFields();
    setDefaultsError('');
    setDefaultsLoading(true);
    void loadDefaults().then((defaults) => {
      if (!active) return;
      form.setFieldsValue({ holderName: defaults.holderName, postalCode: defaults.postalCode });
      setRegion(defaults.region);
    }).catch((loadError) => {
      if (active) setDefaultsError(loadError instanceof Error ? loadError.message : String(loadError));
    }).finally(() => {
      if (active) setDefaultsLoading(false);
    });
    return () => { active = false; };
  }, [form, open]);
  return (
    <Modal open={open} title="绑定个人支付方式" okText="绑定并设为默认" cancelText="取消"
      confirmLoading={confirmLoading || defaultsLoading} onCancel={onCancel} onOk={() => form.submit()} forceRender width={600}>
      <Space direction="vertical" size={12} className="panel-stack">
        <Typography.Paragraph>为 {accountLabel} 的 ChatGPT Personal Account 添加信用卡，并设为默认支付方式。</Typography.Paragraph>
        <Alert type="info" showIcon message="卡号和 CVC 仅用于本次 GAM 浏览器操作，不会保存到 Team Manager。" />
        <Form<FormValues> form={form} layout="vertical" disabled={confirmLoading || defaultsLoading} onFinish={(values) => {
          const expiry = parseCardExpiry(values.expiry ?? '');
          if (!expiry) throw new Error('信用卡有效期无效');
          return onSubmit({
            holderName: values.holderName.trim(), postalCode: values.postalCode.trim(),
            card: { number: String(values.number ?? '').replace(/\s+/gu, ''), ...expiry, cvc: String(values.cvc ?? '').trim() }
          });
        }}>
          <Form.Item name="holderName" label="持卡人姓名" extra="默认复用 GAM 注册资料姓名生成器，可手动修改。" rules={[{ required: true, whitespace: true, message: '请输入持卡人姓名' }]}>
            <Input autoComplete="cc-name" placeholder="与卡片账单资料一致" />
          </Form.Item>
          <Typography.Text strong>信用卡</Typography.Text>
          <PaymentCardFields required quickInput numberOnOwnRow />
          <Form.Item name="postalCode" label="账单邮编" extra={`默认使用免税地区 ${region} 的部署账单邮编，可手动修改。`} rules={[{ required: true, whitespace: true, message: '请输入账单邮编' }]}>
            <Input autoComplete="postal-code" placeholder="例如 97210" />
          </Form.Item>
        </Form>
        <ModalErrorAlert message={defaultsError || error} />
      </Space>
    </Modal>
  );
}
