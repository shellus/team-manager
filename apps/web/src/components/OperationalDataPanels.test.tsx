import { App } from 'antd';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { BillingDetailView } from '@team-manager/shared';
import {
  BillingSummary,
  paymentMethodActionKey,
  paymentMethodRowBusy,
  reconcilePaymentMethods,
} from './OperationalDataPanels.js';

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
    const html = render();
    expect(html.match(/设为默认/g)).toHaveLength(1);
    expect(html.match(/移除/g)).toHaveLength(2);
    expect(html).toContain('_default');
    expect(html).toContain('pm_other');
    expect(html).not.toContain('确认移除');
  });

  it('只锁定正在操作的卡片', () => {
    const pendingActions = new Set([paymentMethodActionKey('remove', 'pm_other')]);
    expect(paymentMethodRowBusy(pendingActions, 'pm_other')).toBe(true);
    expect(paymentMethodRowBusy(pendingActions, 'pm_default')).toBe(false);
    expect(paymentMethodActionKey('default', 'pm_other')).toBe('payment-method:default:pm_other');
  });

  it('并发操作的旧响应不会恢复已经移除的卡片', () => {
    const removedPaymentMethodIds = new Set(['pm_default', 'pm_other']);
    expect(reconcilePaymentMethods([
      ...billing.paymentMethods,
      { id: 'pm_new', type: 'card', brand: 'visa', last4: '1881', isDefault: false },
    ], removedPaymentMethodIds).map((paymentMethod) => paymentMethod.id)).toEqual(['pm_new']);
  });
});

function render() {
  return renderToStaticMarkup(
    <App>
      <BillingSummary
        value={billing}
        paymentMethodActions={{
          onSetDefault: async () => ({ targetAccountId: 'personal', paymentMethods: billing.paymentMethods }),
          onRemove: async () => ({ targetAccountId: 'personal', paymentMethods: billing.paymentMethods })
        }}
      />
    </App>
  );
}
