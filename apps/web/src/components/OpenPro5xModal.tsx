import type { OpenPro5xRequest } from '@team-manager/shared';
import { Alert, Form, Input, Modal, Space, Switch, Typography } from 'antd';
import { useEffect, useMemo } from 'react';
import { ModalErrorAlert } from './ModalErrorAlert.js';
import { PaymentCardFields } from './PaymentCardFields.js';
import {
  buildPro5xRequest,
  createPro5xFormValues,
  DEFAULT_PRO_5X_PROMO_CODE,
  type Pro5xFormValues
} from './pro5xRequest.js';

export const PRO_5X_MODAL_COPY = {
  title: '开通 Pro 5x',
  description: '使用固定的新加坡指定 ASN 出口创建 Pro 5x 站内 Checkout，填写付款资料后直接点击 Subscribe 完成付款。任务结束后会恢复账号原代理配置。',
  offerMessage: '首月优惠以站内页面为准',
  offerDescription: '系统会校验 5x 用量和首月零元优惠；续费金额、币种与条款以 ChatGPT 付款页最终展示为准。'
} as const;

export const PRO_5X_RESUME_MODAL_COPY = {
  title: '补充 Pro 5x 信用卡',
  okText: '填写并继续自动付款',
  description: '为当前等待中的 Pro 5x 任务重新提供信用卡；系统收到后会立即填写现有站内付款表单并点击 Subscribe。'
} as const;

export function OpenPro5xModal({
  open,
  confirmLoading,
  error,
  mode = 'open',
  defaultUsePromoCode = true,
  defaultPromoCode = DEFAULT_PRO_5X_PROMO_CODE,
  onCancel,
  onSubmit
}: {
  open: boolean;
  confirmLoading: boolean;
  error: string;
  mode?: 'open' | 'resume';
  defaultUsePromoCode?: boolean;
  defaultPromoCode?: string;
  onCancel: () => void;
  onSubmit: (payload: OpenPro5xRequest) => void | Promise<void>;
}) {
  const [form] = Form.useForm<Pro5xFormValues>();
  const usePromoCode = Form.useWatch('usePromoCode', form) !== false;
  const initialValues = useMemo(
    () => createPro5xFormValues(mode, defaultPromoCode, defaultUsePromoCode),
    [defaultPromoCode, defaultUsePromoCode, mode]
  );

  useEffect(() => {
    form.resetFields();
    form.setFieldsValue(initialValues);
  }, [form, initialValues, open]);

  return (
    <Modal
      className="pro5x-modal"
      open={open}
      title={mode === 'resume' ? PRO_5X_RESUME_MODAL_COPY.title : PRO_5X_MODAL_COPY.title}
      okText={mode === 'resume' ? PRO_5X_RESUME_MODAL_COPY.okText : '开通并自动付款'}
      cancelText="取消"
      confirmLoading={confirmLoading}
      onCancel={onCancel}
      onOk={() => form.submit()}
      forceRender
      width={600}
    >
      <Space direction="vertical" size={12} className="panel-stack">
        <Typography.Paragraph>
          {mode === 'resume'
            ? PRO_5X_RESUME_MODAL_COPY.description
            : PRO_5X_MODAL_COPY.description}
        </Typography.Paragraph>
        <Alert
          type="info"
          showIcon
          message={mode === 'open' && !usePromoCode
            ? '本次不使用优惠码'
            : PRO_5X_MODAL_COPY.offerMessage}
          description={mode === 'open' && !usePromoCode
            ? '系统将创建不带 promo_code 的普通 Pro 5x Checkout，实际金额与条款以付款页为准。'
            : PRO_5X_MODAL_COPY.offerDescription}
        />
        <Form<Pro5xFormValues>
          form={form}
          layout="vertical"
          disabled={confirmLoading}
          initialValues={initialValues}
          onFinish={(values) => onSubmit(buildPro5xRequest(values))}
        >
          {mode === 'open' && (
            <>
              <Form.Item
                name="usePromoCode"
                label="使用优惠码"
                valuePropName="checked"
                extra="默认勾选并填入 stb；关闭后账单请求不会携带 promo_code。"
              >
                <Switch checkedChildren="使用优惠码" unCheckedChildren="不使用优惠码" />
              </Form.Item>
              <Form.Item
                name="promoCode"
                label="优惠码"
                rules={usePromoCode ? [{ required: true, whitespace: true, message: '请输入优惠码' }] : undefined}
              >
                <Input
                  disabled={!usePromoCode}
                  placeholder="输入 Pro 5x 优惠码"
                  autoComplete="off"
                />
              </Form.Item>
            </>
          )}
          <Typography.Text strong>信用卡（必填）</Typography.Text>
          <PaymentCardFields required quickInput numberOnOwnRow />
          <Typography.Text type="secondary" className="payment-security-note">
            Team Manager 不保存卡片；GAM 会加密保存未完成任务的付款资料，服务热重载后自动继续。
          </Typography.Text>
        </Form>
        <ModalErrorAlert message={error} />
      </Space>
    </Modal>
  );
}
