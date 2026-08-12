import { useMemo, useState } from 'react';
import { Alert, Button, Form, Input, InputNumber, Modal, Radio, Select, Space, Switch } from 'antd';
import { PERSONAL_PLAN_OPTIONS, type ChangePersonalSubscriptionRequest, type PersonalPlan } from '@team-manager/shared';
import { unifiedApi } from '../../unifiedApi.js';

export function SubscriptionModal({ accountId, currentPlan, open, onClose }: {
  accountId: string; currentPlan: PersonalPlan; open: boolean; onClose: () => void;
}) {
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const isFree = currentPlan === 'free';
  const initial = useMemo(() => ({ mode: isFree ? 'start_new' : 'change_existing', targetPlan: 'plus', country: 'US', currency: 'USD', autoPay: false }), [isFree]);
  const submit = async (values: any) => {
    setBusy(true); setError(''); setResult('');
    try {
      const request: ChangePersonalSubscriptionRequest = {
        targetPlan: values.targetPlan, mode: values.mode, country: values.country.toUpperCase(),
        currency: values.currency.toUpperCase(), autoPay: values.autoPay === true,
        ...(values.promoCode ? { promoCode: values.promoCode } : {}),
        ...(values.cardNumber ? { card: { number: values.cardNumber, expiryMonth: values.expiryMonth, expiryYear: values.expiryYear, cvc: values.cvc } } : {})
      };
      const operation = await unifiedApi.changePersonalSubscription(accountId, request);
      setResult(`操作已创建：${operation.phase}`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <Modal title="个人套餐" open={open} onCancel={onClose} footer={null} destroyOnClose>
    <Alert type={isFree ? 'info' : 'warning'} showIcon message={isFree ? '当前为 Free，可全新开通四种套餐。' : '付费套餐间切换尚未完成上游协议验证，当前会被安全拒绝。'} />
    <Form form={form} layout="vertical" initialValues={initial} onFinish={submit} style={{ marginTop: 16 }}>
      <Form.Item name="mode" label="操作模式"><Radio.Group options={[{ label: '全新开通', value: 'start_new', disabled: !isFree }, { label: '变更现有套餐（尚未验证）', value: 'change_existing', disabled: true }]} /></Form.Item>
      <Form.Item name="targetPlan" label="目标套餐" rules={[{ required: true }]}><Select options={PERSONAL_PLAN_OPTIONS.map((item) => ({ value: item.plan, label: `${item.label} · ${item.planName}` }))} /></Form.Item>
      <Space align="start"><Form.Item name="country" label="国家" rules={[{ required: true, pattern: /^[A-Za-z]{2}$/ }]}><Input maxLength={2} /></Form.Item><Form.Item name="currency" label="货币" rules={[{ required: true, pattern: /^[A-Za-z]{3}$/ }]}><Input maxLength={3} /></Form.Item></Space>
      <Form.Item name="promoCode" label="优惠码"><Input /></Form.Item>
      <Form.Item name="autoPay" label="自动提交" valuePropName="checked"><Switch /></Form.Item>
      <Form.Item name="cardNumber" label="新卡卡号（可选）"><Input inputMode="numeric" autoComplete="cc-number" /></Form.Item>
      <Space align="start"><Form.Item name="expiryMonth" label="月"><InputNumber min={1} max={12} /></Form.Item><Form.Item name="expiryYear" label="年"><InputNumber min={2026} max={2100} /></Form.Item><Form.Item name="cvc" label="CVC"><Input.Password maxLength={4} /></Form.Item></Space>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}{result && <Alert type="success" showIcon message={result} style={{ marginBottom: 12 }} />}
      <Button type="primary" htmlType="submit" loading={busy}>创建套餐操作</Button>
    </Form>
  </Modal>;
}
