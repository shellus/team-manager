import { Form, Input, InputNumber, Space } from 'antd';

export function PaymentCardFields({ prefix = '' }: { prefix?: string }) {
  const name = (field: string) => prefix ? [prefix, field] : field;
  return <>
    <Form.Item name={name('number')} label="卡号" rules={[{ required: true }]}><Input inputMode="numeric" autoComplete="cc-number" /></Form.Item>
    <Space wrap align="start">
      <Form.Item name={name('expiryMonth')} label="有效月" rules={[{ required: true }]}><InputNumber min={1} max={12} /></Form.Item>
      <Form.Item name={name('expiryYear')} label="有效年" rules={[{ required: true }]}><InputNumber min={2026} max={2100} /></Form.Item>
      <Form.Item name={name('cvc')} label="CVC" rules={[{ required: true }]}><Input.Password maxLength={4} /></Form.Item>
    </Space>
  </>;
}
