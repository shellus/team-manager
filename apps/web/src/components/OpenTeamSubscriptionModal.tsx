import type { OpenTeamSubscriptionRequest, TeamUpgradeWorkspaceOption } from '@team-manager/shared';
import { Alert, Form, Input, Modal, Select, Space, Switch, Typography } from 'antd';
import { useEffect } from 'react';
import { normalizeCardExpiryInput, parseCardExpiry } from './cardExpiry.js';
import { ModalErrorAlert } from './ModalErrorAlert.js';
import {
  billingCurrencyForCountry,
  parsePromotionTriplet,
  TEAM_CHECKOUT_COUNTRIES,
  TEAM_CHECKOUT_CURRENCIES
} from './teamCheckoutOptions.js';
import {
  buildTeamSubscriptionRequest,
  DEFAULT_TEAM_SUBSCRIPTION_FORM_VALUES,
  type TeamSubscriptionFormValues
} from './teamSubscriptionRequest.js';

export function OpenTeamSubscriptionModal({
  open,
  confirmLoading,
  error,
  workspaceOptions,
  onCancel,
  onSubmit
}: {
  open: boolean;
  confirmLoading: boolean;
  error: string;
  workspaceOptions: TeamUpgradeWorkspaceOption[];
  onCancel: () => void;
  onSubmit: (payload: OpenTeamSubscriptionRequest) => void | Promise<void>;
}) {
  const [form] = Form.useForm<TeamSubscriptionFormValues>();
  const autoPay = Form.useWatch('autoPay', form) === true;

  useEffect(() => {
    if (open) form.setFieldsValue(DEFAULT_TEAM_SUBSCRIPTION_FORM_VALUES);
  }, [form, open]);

  const cardValidator = (field: keyof Pick<TeamSubscriptionFormValues, 'number' | 'expiry' | 'cvc'>) => {
    const values = form.getFieldsValue(['number', 'expiry', 'cvc']);
    const hasAny = Boolean(values.number?.trim() || values.expiry?.trim() || values.cvc?.trim());
    if (!hasAny) return Promise.resolve();
    const value = values[field]?.trim();
    if (!value) return Promise.reject(new Error('填写信用卡时，卡号、有效期和 CVC 必须完整'));
    if (field === 'number' && !/^\d{12,19}$/.test(value.replace(/\s+/g, ''))) {
      return Promise.reject(new Error('卡号应为 12 至 19 位数字'));
    }
    if (field === 'expiry' && !parseCardExpiry(value)) {
      return Promise.reject(new Error('有效期格式为 MM/YY 或 MM/YYYY'));
    }
    if (field === 'cvc' && !/^\d{3,4}$/.test(value)) {
      return Promise.reject(new Error('CVC 应为 3 或 4 位数字'));
    }
    return Promise.resolve();
  };

  return (
    <Modal
      className="team-subscription-modal"
      open={open}
      title="开通双席位 Team"
      okText={autoPay ? '创建订单并自动付款' : '创建订单并打开付款页'}
      cancelText="取消"
      confirmLoading={confirmLoading}
      onCancel={onCancel}
      onOk={() => form.submit()}
      destroyOnHidden
      width={600}
    >
      <Space direction="vertical" size={12} className="panel-stack">
        <Typography.Paragraph>
          创建两个固定席位的 Team 月付订单。目标 Workspace 留空时新建 Team；选择现有空间时升级该 Workspace。创建订单时临时使用所选国家的 1024 出口，取得订单链接后恢复账号原出口。
        </Typography.Paragraph>
        <Alert
          type="info"
          showIcon
          message="信用卡可以留空"
          description="留空时会尝试使用 Stripe 已保存的支付方式；页面无法直接付款时会保留现场并进入人工处理。"
        />
        <Form<TeamSubscriptionFormValues>
          form={form}
          layout="vertical"
          disabled={confirmLoading}
          preserve={false}
          onFinish={(values) => onSubmit(buildTeamSubscriptionRequest(values))}
        >
          <Form.Item
            name="workspaceId"
            label="目标 Workspace（可选）"
            extra="不选择时创建新的 Team workspace；选择后升级指定空间。"
          >
            <Select
              allowClear
              showSearch
              placeholder="不选择，创建新 Team workspace"
              optionFilterProp="label"
              notFoundContent="没有可升级的 Workspace"
              options={workspaceOptions.map((workspace) => ({
                value: workspace.id,
                label: `${workspace.name || workspace.id} · ${workspacePlanLabel(workspace.planType)}${workspace.isDeactivated ? ' · 已停用' : ''}`
              }))}
            />
          </Form.Item>
          <Form.Item
            name="promotion"
            label="优惠码（可选）"
            extra="可直接粘贴“优惠码|国家|货币”，国家和货币会自动带入。"
          >
            <Input
              placeholder="PROMO 或 PROMO|US|USD"
              autoComplete="off"
              onBlur={(event) => {
                const parsed = parsePromotionTriplet(event.target.value);
                form.setFieldsValue({
                  ...(parsed.country ? { country: parsed.country } : {}),
                  ...(parsed.currency ? { currency: parsed.currency } : {})
                });
              }}
            />
          </Form.Item>
          <div className="payment-field-row">
            <Form.Item name="country" label="国家（订单出口）" rules={[{ required: true }]}>
              <Select
                showSearch
                options={TEAM_CHECKOUT_COUNTRIES}
                optionFilterProp="label"
                onChange={(country) => form.setFieldValue('currency', billingCurrencyForCountry(country))}
              />
            </Form.Item>
            <Form.Item name="currency" label="账单货币" rules={[{ required: true }]}>
              <Select showSearch options={TEAM_CHECKOUT_CURRENCIES.map((value) => ({ value, label: value }))} />
            </Form.Item>
          </div>
          <Form.Item
            name="autoPay"
            label="自动支付"
            valuePropName="checked"
            extra="默认关闭。关闭时只准备付款页面，由人工核对并点击 Pay；系统仍会持续监听支付结果。"
          >
            <Switch checkedChildren="自动点击 Pay" unCheckedChildren="人工点击 Pay" />
          </Form.Item>
          <Typography.Text strong>信用卡（可选）</Typography.Text>
          <Form.Item name="number" label="卡号" dependencies={['expiry', 'cvc']} rules={[{ validator: () => cardValidator('number') }]}>
            <Input inputMode="numeric" autoComplete="cc-number" placeholder="留空则复用 Stripe 已保存卡片" maxLength={23} />
          </Form.Item>
          <div className="payment-field-row">
            <Form.Item
              name="expiry"
              label="有效期"
              dependencies={['number', 'cvc']}
              getValueFromEvent={(event) => normalizeCardExpiryInput(event.target.value)}
              rules={[{ validator: () => cardValidator('expiry') }]}
            >
              <Input inputMode="numeric" autoComplete="cc-exp" placeholder="MM/YY 或 MM/YYYY" maxLength={7} />
            </Form.Item>
            <Form.Item name="cvc" label="CVC" dependencies={['number', 'expiry']} rules={[{ validator: () => cardValidator('cvc') }]}>
              <Input inputMode="numeric" autoComplete="cc-csc" placeholder="CVC" maxLength={4} />
            </Form.Item>
          </div>
        </Form>
        <ModalErrorAlert message={error} />
      </Space>
    </Modal>
  );
}

function workspacePlanLabel(planType: string): string {
  if (planType === 'self_serve_business_usage_based') return '0.52 usage-based';
  return planType || '未知套餐';
}
