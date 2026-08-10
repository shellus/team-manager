import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  upcomingInvoiceHasTeamSubscription,
  upcomingInvoiceNextPaymentAt,
  upcomingInvoiceRenewalAmount
} from './teamSubscription.js';

describe('upcomingInvoiceHasTeamSubscription', () => {
  it('recognizes a current recurring Team invoice', () => {
    assert.equal(upcomingInvoiceHasTeamSubscription({
      subscription: 'sub_current',
      lines: {
        data: [{
          type: 'subscription',
          quantity: 2,
          price: { recurring: { interval: 'month' } }
        }]
      }
    }), true);
  });

  it('recognizes the newer nested Stripe subscription reference', () => {
    assert.equal(upcomingInvoiceHasTeamSubscription({
      parent: {
        subscription_details: { subscription: 'sub_nested' }
      }
    }), true);
  });

  it('does not treat a missing upcoming invoice as Team', () => {
    assert.equal(upcomingInvoiceHasTeamSubscription(null), false);
    assert.equal(upcomingInvoiceHasTeamSubscription({ lines: { data: [] } }), false);
  });
});

describe('upcomingInvoiceNextPaymentAt', () => {
  it('formats the expected charge time with seconds in Asia/Shanghai', () => {
    assert.equal(
      upcomingInvoiceNextPaymentAt({ next_payment_attempt: 1784784000 }),
      '2026-07-23 13:20:00'
    );
  });

  it('ignores missing or invalid expected charge times', () => {
    assert.equal(upcomingInvoiceNextPaymentAt({}), undefined);
    assert.equal(upcomingInvoiceNextPaymentAt({ next_payment_attempt: null }), undefined);
  });
});

describe('upcomingInvoiceRenewalAmount', () => {
  it('reads amount due and normalizes the original currency', () => {
    assert.deepEqual(
      upcomingInvoiceRenewalAmount({ amount_due: 1238, total: 1100, currency: 'gbp' }),
      { amount: 1238, currency: 'GBP' }
    );
  });

  it('falls back to total and ignores invalid invoices', () => {
    assert.deepEqual(upcomingInvoiceRenewalAmount({ total: 2600, currency: 'cad' }), {
      amount: 2600,
      currency: 'CAD'
    });
    assert.equal(upcomingInvoiceRenewalAmount({ amount_due: null, currency: 'gbp' }), undefined);
  });
});
