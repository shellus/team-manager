import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Pro5xPaymentStatisticsView } from '@team-manager/shared';
import { describe, expect, test } from 'vitest';
import { Pro5xPaymentStatisticsPanel } from './Pro5xPaymentStatisticsPanel.js';

const statistics: Pro5xPaymentStatisticsView = {
  totalAttempts: 2,
  decisionAttempts: 2,
  uniqueOperations: 1,
  succeeded: 1,
  paymentNotApproved: 1,
  cardDeclined: 0,
  technicalFailures: 0,
  interrupted: 0,
  waitingManual: 0,
  pending: 0,
  transitions: {
    payment_not_approved_to_succeeded: 1,
    payment_not_approved_to_payment_not_approved: 0,
    payment_not_approved_to_card_declined: 0,
    card_declined_to_succeeded: 0,
    card_declined_to_payment_not_approved: 0,
    card_declined_to_card_declined: 0
  },
  recentAttempts: [{
    id: 'attempt-2',
    operationId: 'operation-1',
    accountId: 'user@example.com',
    cardLast4: '4242',
    cardFingerprintSuffix: 'fingerprint-suffix',
    number: 2,
    startedAt: 2_000,
    completedAt: 3_000,
    outcome: 'succeeded',
    decision: 'succeeded',
    proxyObservation: {
      sid: 'MSgJNEgw',
      ip: '203.0.113.20',
      country: 'SG',
      asn: 'AS18106',
      state: null,
      city: null,
      observedAt: 2_100
    },
    billingObservation: {
      email: 'user@example.com',
      holderName: 'Test Holder',
      address: {
        line1: '1 Example Place',
        city: 'Singapore',
        postalCode: '000000',
        phone: '+65 6123 4567',
        country: 'SG'
      },
      recordedAt: 2_200
    },
    checkoutSessionId: 'cs_live_full_session_id',
    checkoutRecreated: true,
    intervalFromPreviousMs: 65_000,
    cardHardFailure: false
  }],
  updatedAt: 3_000
};

describe('Pro5xPaymentStatisticsPanel', () => {
  test('renders retry conversion and original attempt observations', () => {
    const html = renderToStaticMarkup(
      createElement(Pro5xPaymentStatisticsPanel, { initialStatistics: statistics })
    );

    expect(html).toContain('PNA → 成功');
    expect(html).toContain('203.0.113.20');
    expect(html).toContain('MSgJNEgw');
    expect(html).toContain('AS18106');
    expect(html).toContain('cs_live_full_session_id');
    expect(html).toContain('已重新创建订单');
    expect(html).toContain('Test Holder');
    expect(html).toContain('1 Example Place, Singapore, 000000, SG');
    expect(html).toContain('距上次 1 分 5 秒');
  });
});
