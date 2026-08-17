import { describe, expect, test } from 'vitest';
import { renewalStatusMeta } from './OverviewPage.js';

describe('母号概览状态', () => {
  test('临近日期统一显示三天内到期', () => {
    expect(renewalStatusMeta.expiring_soon.label).toBe('三天内到期');
  });

  test('当期发票未支付时显示待支付', () => {
    expect(renewalStatusMeta.payment_due.label).toBe('待支付');
  });
});
