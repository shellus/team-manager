import assert from 'node:assert/strict';
import test from 'node:test';
import { seatExpirationBusinessDate, seatSlotExpirationStatus } from './domain/businessDate.js';

test('客户席位业务日期在北京时间零点切换', () => {
  assert.equal(seatExpirationBusinessDate(new Date('2026-08-24T15:59:59.999Z')), '2026-08-24');
  assert.equal(seatExpirationBusinessDate(new Date('2026-08-24T16:00:00.000Z')), '2026-08-25');
});

test('客户席位到期状态只按北京时间自然日派生', () => {
  const beforeMidnight=new Date('2026-08-24T15:59:59.999Z');
  const afterMidnight=new Date('2026-08-24T16:00:00.000Z');
  assert.equal(seatSlotExpirationStatus(null,afterMidnight),'not_set');
  assert.equal(seatSlotExpirationStatus('2026-08-24',beforeMidnight),'expires_today');
  assert.equal(seatSlotExpirationStatus('2026-08-24',afterMidnight),'expired');
  assert.equal(seatSlotExpirationStatus('2026-08-25',afterMidnight),'expires_today');
});
