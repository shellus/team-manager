import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseOpenCodexSpaceRequest } from './openCodexSpaceRequest.js';
import { ServiceError } from './teamService.js';

const now = new Date('2026-07-21T00:00:00Z');

describe('parseOpenCodexSpaceRequest', () => {
  it('normalizes and accepts a complete explicit request', () => {
    assert.deepEqual(parseOpenCodexSpaceRequest({
      country: 'it',
      currency: 'eur',
      credits: 16,
      card: {
        number: '4242 4242 4242 4242',
        expiryMonth: 7,
        expiryYear: 2028,
        cvc: '123'
      }
    }, now), {
      country: 'IT',
      currency: 'EUR',
      credits: 16,
      card: {
        number: '4242424242424242',
        expiryMonth: 7,
        expiryYear: 2028,
        cvc: '123'
      }
    });
  });

  it('rejects missing order defaults instead of silently filling them', () => {
    assert.throws(
      () => parseOpenCodexSpaceRequest({
        card: {
          number: '4242424242424242',
          expiryMonth: 7,
          expiryYear: 2028,
          cvc: '123'
        }
      }, now),
      (error: unknown) => error instanceof ServiceError
        && error.status === 400
        && error.message === '国家必须是 2 位字母代码'
    );
  });

  it('rejects invalid credits and incomplete card fields', () => {
    assert.throws(
      () => parseOpenCodexSpaceRequest({
        country: 'IT',
        currency: 'EUR',
        credits: 0,
        card: {}
      }, now),
      (error: unknown) => error instanceof ServiceError
        && error.status === 400
        && error.message === '积分数量必须大于 0'
    );
    assert.throws(
      () => parseOpenCodexSpaceRequest({
        country: 'IT',
        currency: 'EUR',
        credits: 16,
        card: {
          number: '4242424242424242',
          expiryMonth: 7,
          expiryYear: 2028
        }
      }, now),
      (error: unknown) => error instanceof ServiceError
        && error.status === 400
        && error.message === 'CVC 应为 3 或 4 位数字'
    );
  });

  it('rejects unsupported country and currency codes', () => {
    assert.throws(
      () => parseOpenCodexSpaceRequest({
        country: 'ZZ',
        currency: 'EUR',
        credits: 16,
        card: {
          number: '4242424242424242',
          expiryMonth: 7,
          expiryYear: 2028,
          cvc: '123'
        }
      }, now),
      (error: unknown) => error instanceof ServiceError
        && error.status === 400
        && error.message === '不支持的国家代码: ZZ'
    );
    assert.throws(
      () => parseOpenCodexSpaceRequest({
        country: 'IT',
        currency: 'XYZ',
        credits: 16,
        card: {
          number: '4242424242424242',
          expiryMonth: 7,
          expiryYear: 2028,
          cvc: '123'
        }
      }, now),
      (error: unknown) => error instanceof ServiceError
        && error.status === 400
        && error.message === '不支持的账单货币: XYZ'
    );
  });
});
