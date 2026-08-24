import assert from 'node:assert/strict';
import test from 'node:test';
import { hasOutstandingInvoice } from './repositories/billingRepository.js';
import { renewalOperationalStatus, renewalRisks, seatRisks } from './services/systemService.js';

test('席位概览只在到期前三天开始提醒', () => {
  const now = new Date('2026-08-17T12:00:00Z');

  assert.deepEqual(seatRisks('2026-08-20', 'active', false, now), ['三天内到期']);
  assert.deepEqual(seatRisks('2026-08-21', 'active', false, now), []);
  assert.deepEqual(seatRisks('2026-08-16', 'active', false, now), ['客户席位已到期']);
});

test('席位概览在北京时间零点后才把前一日席位标记为到期', () => {
  assert.deepEqual(seatRisks('2026-08-24', 'active', false, new Date('2026-08-24T15:59:59.999Z')), ['三天内到期']);
  assert.deepEqual(seatRisks('2026-08-24', 'active', false, new Date('2026-08-24T16:00:00.000Z')), ['客户席位已到期']);
});

test('母号概览在到期前三天统一按到期提醒', () => {
  const now = new Date('2026-08-17T12:00:00Z');
  const withinThreeDays = { renewalAt: '2026-08-20T12:00:00Z', willRenew: true };
  const afterThreeDays = { renewalAt: '2026-08-20T12:00:01Z', willRenew: true };

  assert.deepEqual(renewalRisks(withinThreeDays, now), ['三天内到期']);
  assert.equal(renewalOperationalStatus(withinThreeDays, now), 'expiring_soon');
  assert.deepEqual(renewalRisks(afterThreeDays, now), []);
  assert.equal(renewalOperationalStatus(afterThreeDays, now), 'normal');
});

test('母号概览以当期待付发票覆盖正常状态', () => {
  const payload = {
    upcomingInvoice: { upcoming_invoice: { status: 'draft', amount_due: 1100 } },
    invoices: { data: [{ status: 'open', amount_due: 1100, amount_remaining: 1100 }] }
  };

  assert.equal(hasOutstandingInvoice(payload), true);
  assert.deepEqual(renewalRisks({ renewalAt: '2026-09-16T12:00:00Z', paymentDue: true }, new Date('2026-08-17T12:00:00Z')), ['当期账单待支付']);
  assert.equal(renewalOperationalStatus({ renewalAt: '2026-09-16T12:00:00Z', paymentDue: true }, new Date('2026-08-17T12:00:00Z')), 'payment_due');
  assert.equal(hasOutstandingInvoice({ invoices: { data: [{ status: 'paid', amount_remaining: 0 }] } }), false);
});
