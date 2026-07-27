import { Form } from 'antd';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { PAYMENT_CARD_QUICK_INPUT_COPY, PaymentCardFields } from './PaymentCardFields.js';

describe('PaymentCardFields', () => {
  test('renders the shared quick card input when requested', () => {
    const html = renderToStaticMarkup(
      <Form initialValues={{ cardQuickInput: '', number: '', expiry: '', cvc: '' }}>
        <PaymentCardFields required quickInput numberOnOwnRow />
      </Form>
    );

    expect(html).toContain(PAYMENT_CARD_QUICK_INPUT_COPY.label);
    expect(html).toContain(PAYMENT_CARD_QUICK_INPUT_COPY.placeholder);
    expect(html).toContain(PAYMENT_CARD_QUICK_INPUT_COPY.format);
  });
});
