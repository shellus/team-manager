import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type {
  AccountManagerOperationView,
  Pro5xPaymentStatisticsView
} from '@team-manager/shared';
import {
  normalizePro5xCardLast4,
  pro5xOperationCardLast4,
  successfulPro5xCardLast4ByAccount
} from './pro5xPaymentCard.js';

describe('Pro 5x payment card tail', () => {
  it('accepts only a four-digit card tail', () => {
    assert.equal(normalizePro5xCardLast4(' 4242 '), '4242');
    assert.equal(normalizePro5xCardLast4('42'), undefined);
    assert.equal(normalizePro5xCardLast4('abcd'), undefined);
  });

  it('reads the safe card tail from an operation summary', () => {
    const operation = {
      requestSummary: { cardLast4: '4444' }
    } as AccountManagerOperationView;
    assert.equal(pro5xOperationCardLast4(operation), '4444');
  });

  it('keeps the newest successful payment tail per normalized account', () => {
    const statistics = {
      recentAttempts: [
        {
          accountId: ' OWNER@EXAMPLE.COM ', cardLast4: '1111', decision: 'succeeded',
          startedAt: 1_000, completedAt: 2_000, number: 1
        },
        {
          accountId: 'owner@example.com', cardLast4: '4242', decision: 'succeeded',
          startedAt: 3_000, completedAt: 4_000, number: 2
        },
        {
          accountId: 'child@example.com', cardLast4: '9999', decision: 'card_declined',
          startedAt: 5_000, completedAt: 6_000, number: 3
        },
        {
          accountId: 'invalid@example.com', cardLast4: 'abcd', decision: 'succeeded',
          startedAt: 7_000, completedAt: 8_000, number: 4
        }
      ]
    } as Pro5xPaymentStatisticsView;

    const result = successfulPro5xCardLast4ByAccount(statistics);
    assert.equal(result.get('owner@example.com'), '4242');
    assert.equal(result.has('child@example.com'), false);
    assert.equal(result.has('invalid@example.com'), false);
  });
});
