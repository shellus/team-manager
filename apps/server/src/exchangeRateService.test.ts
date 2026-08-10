import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FrankfurterExchangeRateService } from './exchangeRateService.js';

describe('FrankfurterExchangeRateService', () => {
  it('loads and caches a CNY quote for the original billing currency', async () => {
    let calls = 0;
    const service = new FrankfurterExchangeRateService(async (input) => {
      calls += 1;
      assert.equal(String(input), 'https://rates.example/v2/rate/GBP/CNY');
      return new Response(JSON.stringify({ date: '2026-08-10', base: 'GBP', quote: 'CNY', rate: 9.0778 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }, 'https://rates.example', 60_000, () => 1_000);

    const first = await service.getCnyRate('gbp');
    const second = await service.getCnyRate('GBP');
    assert.deepEqual(first, { base: 'GBP', quote: 'CNY', rate: 9.0778, date: '2026-08-10' });
    assert.deepEqual(second, first);
    assert.equal(calls, 1);
  });

  it('does not fail the overview when the rate service is unavailable', async () => {
    const service = new FrankfurterExchangeRateService(async () => new Response('unavailable', { status: 503 }));
    assert.equal(await service.getCnyRate('CAD'), undefined);
  });
});
