import { Form, Input } from 'antd';
import { useState } from 'react';
import { normalizeCardExpiryInput, parseCardExpiry } from './cardExpiry.js';
import { parseCardQuickInput } from './cardQuickInput.js';

export interface PaymentCardFieldValues {
  cardQuickInput?: string;
  number?: string;
  expiry?: string;
  cvc?: string;
}

export const PAYMENT_CARD_QUICK_INPUT_COPY = {
  label: '快捷输入（可选）',
  placeholder: '4242424242424242----07/28----123',
  format: '格式：卡号----有效期----CVC，支持 MM/YY 和 MM/YYYY',
  filled: '已填充下面三个卡片字段',
  invalid: '无法识别，请检查分隔符、卡号、有效期和 CVC'
} as const;

export function PaymentCardFields({
  required,
  rowClassName = 'payment-field-row',
  numberPlaceholder = '4242 4242 4242 4242',
  numberOnOwnRow = false,
  quickInput = false
}: {
  required: boolean;
  rowClassName?: string;
  numberPlaceholder?: string;
  numberOnOwnRow?: boolean;
  quickInput?: boolean;
}) {
  const form = Form.useFormInstance<PaymentCardFieldValues>();
  const [quickInputBlurred, setQuickInputBlurred] = useState(false);
  const quickInputValue = Form.useWatch('cardQuickInput', form) || '';
  const parsedQuickInput = parseCardQuickInput(quickInputValue);
  const quickInputStatus = !quickInputValue.trim()
    ? 'idle'
    : parsedQuickInput
      ? 'filled'
      : quickInputBlurred
        ? 'invalid'
        : 'idle';
  const validator = (field: keyof PaymentCardFieldValues) => {
    const values = form.getFieldsValue(['number', 'expiry', 'cvc']);
    const hasAny = Boolean(values.number?.trim() || values.expiry?.trim() || values.cvc?.trim());
    if (!required && !hasAny) return Promise.resolve();
    const value = values[field]?.trim();
    if (!value) {
      return Promise.reject(new Error(required
        ? '卡号、有效期和 CVC 均为必填项'
        : '填写信用卡时，卡号、有效期和 CVC 必须完整'));
    }
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

  const numberField = (
    <Form.Item
      name="number"
      label="卡号"
      dependencies={['expiry', 'cvc']}
      rules={[{ validator: () => validator('number') }]}
    >
      <Input
        inputMode="numeric"
        autoComplete="cc-number"
        placeholder={numberPlaceholder}
        maxLength={23}
      />
    </Form.Item>
  );
  const quickInputField = quickInput ? (
    <Form.Item
      name="cardQuickInput"
      label={PAYMENT_CARD_QUICK_INPUT_COPY.label}
      validateStatus={quickInputStatus === 'idle' ? undefined : quickInputStatus === 'filled' ? 'success' : 'error'}
      help={quickInputStatus === 'invalid' ? PAYMENT_CARD_QUICK_INPUT_COPY.invalid : undefined}
      extra={quickInputStatus === 'filled'
        ? PAYMENT_CARD_QUICK_INPUT_COPY.filled
        : PAYMENT_CARD_QUICK_INPUT_COPY.format}
    >
      <Input
        autoComplete="off"
        spellCheck={false}
        placeholder={PAYMENT_CARD_QUICK_INPUT_COPY.placeholder}
        onChange={(event) => {
          setQuickInputBlurred(false);
          const parsed = parseCardQuickInput(event.target.value);
          if (parsed) form.setFieldsValue(parsed);
        }}
        onBlur={() => setQuickInputBlurred(true)}
      />
    </Form.Item>
  ) : null;
  const secondaryFields = (
    <>
      <Form.Item
        name="expiry"
        label="有效期"
        dependencies={['number', 'cvc']}
        getValueFromEvent={(event) => normalizeCardExpiryInput(event.target.value)}
        rules={[{ validator: () => validator('expiry') }]}
      >
        <Input inputMode="numeric" autoComplete="cc-exp" placeholder="MM/YY" maxLength={7} />
      </Form.Item>
      <Form.Item
        name="cvc"
        label="CVC"
        dependencies={['number', 'expiry']}
        rules={[{ validator: () => validator('cvc') }]}
      >
        <Input inputMode="numeric" autoComplete="cc-csc" placeholder="CVC" maxLength={4} />
      </Form.Item>
    </>
  );

  if (numberOnOwnRow) {
    return (
      <>
        {quickInputField}
        {numberField}
        <div className={rowClassName}>{secondaryFields}</div>
      </>
    );
  }
  return (
    <>
      {quickInputField}
      <div className={rowClassName}>
        {numberField}
        {secondaryFields}
      </div>
    </>
  );
}
