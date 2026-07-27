import { describe, expect, test } from 'vitest';
import { PRO_5X_MODAL_COPY, PRO_5X_RESUME_MODAL_COPY } from './OpenPro5xModal.js';
import { PAYMENT_CARD_QUICK_INPUT_COPY } from './PaymentCardFields.js';

describe('OpenPro5xModal', () => {
  test('describes the station checkout, fixed Singapore ASN exit and automatic submission', () => {
    expect(PRO_5X_MODAL_COPY.title).toContain('Pro 5x');
    expect(PRO_5X_MODAL_COPY.description).toContain('新加坡指定 ASN');
    expect(PRO_5X_MODAL_COPY.description).toContain('站内 Checkout');
    expect(PRO_5X_MODAL_COPY.description).toContain('直接点击 Subscribe');
    expect(PRO_5X_MODAL_COPY.offerDescription).toContain('首月零元优惠');
  });

  test('uses the shared card quick input format', () => {
    expect(PAYMENT_CARD_QUICK_INPUT_COPY.placeholder).toContain('----');
  });

  test('reuses the card quick input to resume a waiting task', () => {
    expect(PRO_5X_RESUME_MODAL_COPY.title).toContain('补充 Pro 5x 信用卡');
    expect(PRO_5X_RESUME_MODAL_COPY.okText).toContain('继续自动付款');
    expect(PRO_5X_RESUME_MODAL_COPY.description).toContain('重新提供信用卡');
  });
});
