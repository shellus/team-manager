import { App } from 'antd';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { BillingDetailView } from '@team-manager/shared';
import { BillingSummary, paymentMethodActionKey } from './OperationalDataPanels.js';

const billing = {
  observedAt: '2026-08-18T00:00:00.000Z',
  invoices: [],
  paymentMethods: [
    { id: 'pm_default', type: 'card', brand: 'visa', last4: '4242', isDefault: true },
    { id: 'pm_other', type: 'card', brand: 'mastercard', last4: '4444', isDefault: false }
  ]
} as BillingDetailView;

describe('支付方式操作', () => {
  it('默认卡不重复显示设置入口，每张卡都可直接移除', () => {
    const html = render('');
    expect(html.match(/设为默认/g)).toHaveLength(1);
    expect(html.match(/移除/g)).toHaveLength(2);
    expect(html).not.toContain('确认移除');
  });

  it('被点击的操作按支付方式 ID 进入 loading', () => {
    const html = render(paymentMethodActionKey('remove', 'pm_other'));
    expect(html).toContain('ant-btn-loading');
    expect(paymentMethodActionKey('default', 'pm_other')).toBe('payment-method:default:pm_other');
  });
});

function render(busy: string) {
  return renderToStaticMarkup(
    <App>
      <BillingSummary
        value={billing}
        paymentMethodActions={{
          busy,
          onSetDefault: async () => undefined,
          onRemove: async () => undefined
        }}
      />
    </App>
  );
}
