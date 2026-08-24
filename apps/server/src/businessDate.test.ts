import assert from 'node:assert/strict';
import test from 'node:test';
import { seatExpirationBusinessDate } from './domain/businessDate.js';

test('客户席位业务日期在北京时间零点切换', () => {
  assert.equal(seatExpirationBusinessDate(new Date('2026-08-24T15:59:59.999Z')), '2026-08-24');
  assert.equal(seatExpirationBusinessDate(new Date('2026-08-24T16:00:00.000Z')), '2026-08-25');
});
