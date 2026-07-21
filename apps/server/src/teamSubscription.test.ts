import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { upcomingInvoiceHasTeamSubscription } from './teamSubscription.js';

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
