import { Form, Input, InputNumber, Space } from 'antd';
import { useState } from 'react';
import { parseCardQuickInput } from './cardQuickInput.js';

export function PaymentCardFields({ prefix = '', quickInput = false }: { prefix?: string; quickInput?: boolean }) {
  const form = Form.useFormInstance();
  const [quickError, setQuickError] = useState('');
  const name = (field: string) => prefix ? [prefix, field] : field;
  return <>
    {quickInput && <Form.Item label="快捷输入（可选）" validateStatus={quickError ? 'error' : undefined} help={quickError || '格式：卡号----有效期----CVC，支持 MM/YY 和 MM/YYYY'}>
      <Input
        autoComplete="off"
        placeholder="4242424242424242----07/28----123"
        onChange={(event) => {
          if (!event.target.value.trim()) { setQuickError(''); return; }
          const parsed = parseCardQuickInput(event.target.value);
          if (!parsed) { setQuickError('无法识别，请检查卡号、有效期、CVC 和分隔符'); return; }
          setQuickError('');
          form.setFieldValue(name('number'), parsed.number);
          form.setFieldValue(name('expiryMonth'), parsed.expiryMonth);
          form.setFieldValue(name('expiryYear'), parsed.expiryYear);
          form.setFieldValue(name('cvc'), parsed.cvc);
        }}
      />
    </Form.Item>}
    <Form.Item name={name('number')} label="卡号" rules={[{ required: true }]}><Input inputMode="numeric" autoComplete="cc-number" /></Form.Item>
    <Space wrap align="start">
      <Form.Item name={name('expiryMonth')} label="有效月" rules={[{ required: true }]}><InputNumber min={1} max={12} /></Form.Item>
      <Form.Item name={name('expiryYear')} label="有效年" rules={[{ required: true }]}><InputNumber min={2026} max={2100} /></Form.Item>
      <Form.Item name={name('cvc')} label="CVC" rules={[{ required: true }]}><Input.Password maxLength={4} /></Form.Item>
    </Space>
  </>;
}
