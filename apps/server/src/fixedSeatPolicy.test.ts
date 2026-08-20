import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fixedSeatCapacity, subscriptionSeatsInUse } from './domain/fixedSeat.js';

test('固定席位权益容量与订阅使用数只接受各自有效整数', () => {
  assert.equal(fixedSeatCapacity(4), 4);
  assert.equal(fixedSeatCapacity(0), undefined);
  assert.equal(fixedSeatCapacity(2.5), undefined);
  assert.equal(subscriptionSeatsInUse(0), 0);
  assert.equal(subscriptionSeatsInUse(4), 4);
  assert.equal(subscriptionSeatsInUse('4'), undefined);
});

test('席位业务路径不重新引入固定容量或 HTTP 订单席位数', async () => {
  const [projection, system, teamCode] = await Promise.all([
    readFile(new URL('./repositories/unifiedProjectionRepository.ts', import.meta.url), 'utf8'),
    readFile(new URL('./services/systemService.ts', import.meta.url), 'utf8'),
    readFile(new URL('./teamCodeClient.ts', import.meta.url), 'utf8')
  ]);
  assert.doesNotMatch(projection, /capacity\s*:\s*2\b/);
  assert.doesNotMatch(system, /Math\.max\(\s*2\s*-/);
  assert.doesNotMatch(teamCode, /seatQuantity\s*:\s*2\b/);
});
