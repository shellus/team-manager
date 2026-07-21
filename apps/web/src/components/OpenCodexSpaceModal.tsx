import type { OpenCodexSpaceRequest } from '@team-manager/shared';
import { Alert, Form, Input, InputNumber, Modal, Select, Space, Typography } from 'antd';
import { useState } from 'react';
import { normalizeCardExpiryInput, parseCardExpiry } from './cardExpiry.js';
import { parseCardQuickInput } from './cardQuickInput.js';
import {
  buildCodexSpaceRequest,
  DEFAULT_CODEX_SPACE_FORM_VALUES,
  type CodexSpaceFormValues
} from './codexSpaceRequest.js';
import { ModalErrorAlert } from './ModalErrorAlert.js';
import {
  billingCurrencyForCountry,
  TEAM_CHECKOUT_COUNTRIES,
  TEAM_CHECKOUT_CURRENCIES
} from './teamCheckoutOptions.js';

export function OpenCodexSpaceModal({
  open,
  title = '开通 0.52 Codex 空间',
  description,
  confirmLoading,
  error,
  onCancel,
  onSubmit
}: {
  open: boolean;
  title?: string;
  description: string;
  confirmLoading: boolean;
  error: string;
  onCancel: () => void;
  onSubmit: (payload: OpenCodexSpaceRequest) => void | Promise<void>;
}) {
  const [form] = Form.useForm<CodexSpaceFormValues>();
  const [quickInputStatus, setQuickInputStatus] = useState<'idle' | 'filled' | 'invalid'>('idle');
  const country = Form.useWatch('country', form) ?? DEFAULT_CODEX_SPACE_FORM_VALUES.country;
  const credits = Form.useWatch('credits', form) ?? DEFAULT_CODEX_SPACE_FORM_VALUES.credits;
  const currency = Form.useWatch('currency', form) ?? DEFAULT_CODEX_SPACE_FORM_VALUES.currency;

  return (
    <Modal
      className="codex-space-modal"
      open={open}
      title={title}
      okText="开通 0.52"
      cancelText="取消"
      confirmLoading={confirmLoading}
      onCancel={onCancel}
      onOk={() => form.submit()}
      destroyOnHidden
      width={680}
      afterOpenChange={(visible) => {
        if (!visible) return;
        form.resetFields();
        setQuickInputStatus('idle');
      }}
    >
      <Space direction="vertical" size={8} className="panel-stack">
        <Typography.Paragraph className="compact-modal-description">{description}</Typography.Paragraph>
        <Alert
          className="codex-order-summary"
          type="info"
          showIcon
          message={`订单预设：${country} · ${currency} · ${credits} Credits，最终金额以 Checkout 为准`}
        />
        <Form<CodexSpaceFormValues>
          className="codex-space-form"
          form={form}
          layout="vertical"
          disabled={confirmLoading}
          preserve={false}
          initialValues={DEFAULT_CODEX_SPACE_FORM_VALUES}
          onFinish={(values) => onSubmit(buildCodexSpaceRequest(values))}
        >
          <section className="compact-form-section" aria-labelledby="codex-order-fields-title">
            <div className="compact-form-section-title" id="codex-order-fields-title">
              <Typography.Text strong>订单配置</Typography.Text>
            </div>
            <div className="codex-order-field-row">
              <Form.Item name="country" label="国家" rules={[{ required: true, message: '请选择国家' }]}>
                <Select
                  showSearch
                  optionFilterProp="label"
                  options={TEAM_CHECKOUT_COUNTRIES}
                  onChange={(nextCountry) => {
                    form.setFieldValue('currency', billingCurrencyForCountry(nextCountry));
                  }}
                />
              </Form.Item>
              <Form.Item name="currency" label="账单货币" rules={[{ required: true, message: '请选择货币' }]}>
                <Select
                  showSearch
                  options={TEAM_CHECKOUT_CURRENCIES.map((value) => ({ value, label: value }))}
                />
              </Form.Item>
              <Form.Item
                name="credits"
                label="积分数量"
                rules={[
                  { required: true, message: '请输入积分数量' },
                  {
                    validator: (_, value) => Number.isSafeInteger(value) && value > 0
                      ? Promise.resolve()
                      : Promise.reject(new Error('积分数量必须是正整数'))
                  }
                ]}
              >
                <InputNumber min={1} step={1} precision={0} className="field-full-width" />
              </Form.Item>
            </div>
          </section>

          <section className="compact-form-section" aria-labelledby="codex-card-fields-title">
            <div className="compact-form-section-title" id="codex-card-fields-title">
              <Typography.Text strong>支付卡片</Typography.Text>
            </div>
            <Form.Item
              name="cardQuickInput"
              label="快捷输入（可选）"
              validateStatus={quickInputStatus === 'idle' ? undefined : quickInputStatus === 'filled' ? 'success' : 'error'}
              help={quickInputStatus === 'invalid'
                ? '无法识别，请检查分隔符、卡号、有效期和 CVC'
                : undefined}
              extra={quickInputStatus === 'filled'
                ? '已填充下面三个卡片字段'
                : '格式：卡号----有效期----CVC，支持 MM/YY 和 MM/YYYY'}
            >
              <Input
                autoComplete="off"
                spellCheck={false}
                placeholder="4242424242424242----07/28----123"
                onChange={(event) => {
                  const parsed = parseCardQuickInput(event.target.value);
                  setQuickInputStatus(parsed ? 'filled' : 'idle');
                  if (parsed) form.setFieldsValue(parsed);
                }}
                onBlur={(event) => {
                  if (event.target.value.trim() && !parseCardQuickInput(event.target.value)) {
                    setQuickInputStatus('invalid');
                  }
                }}
              />
            </Form.Item>
            <div className="codex-card-field-row">
              <Form.Item
                name="number"
                label="卡号"
                rules={[
                  { required: true, message: '请输入卡号' },
                  {
                    validator: (_, value) => /^\d{12,19}$/.test(String(value ?? '').replace(/\s+/g, ''))
                      ? Promise.resolve()
                      : Promise.reject(new Error('卡号应为 12 至 19 位数字'))
                  }
                ]}
              >
                <Input inputMode="numeric" autoComplete="cc-number" placeholder="4242 4242 4242 4242" maxLength={23} />
              </Form.Item>
              <Form.Item
                name="expiry"
                label="有效期"
                getValueFromEvent={(event) => normalizeCardExpiryInput(event.target.value)}
                rules={[
                  { required: true, message: '请输入有效期' },
                  {
                    validator: (_, value) => parseCardExpiry(value)
                      ? Promise.resolve()
                      : Promise.reject(new Error('请输入有效期，格式为 MM/YY 或 MM/YYYY'))
                  }
                ]}
              >
                <Input
                  inputMode="numeric"
                  autoComplete="cc-exp"
                  placeholder="MM/YY"
                  maxLength={7}
                />
              </Form.Item>
              <Form.Item
                name="cvc"
                label="CVC"
                rules={[
                  { required: true, message: '请输入 CVC' },
                  { pattern: /^\d{3,4}$/, message: 'CVC 应为 3 或 4 位数字' }
                ]}
              >
                <Input inputMode="numeric" autoComplete="cc-csc" placeholder="CVC" maxLength={4} />
              </Form.Item>
            </div>
            <Typography.Text type="secondary" className="payment-security-note">
              卡号和 CVC 仅转发给 GPT Account Manager 当前进程，不写入 Team Manager 数据或日志。
            </Typography.Text>
          </section>
        </Form>
        <ModalErrorAlert message={error} />
      </Space>
    </Modal>
  );
}
