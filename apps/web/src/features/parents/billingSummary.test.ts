import { describe, expect, test } from 'vitest';
import { buildBillingSummary, formatBillingAmount } from './billingSummary.js';

describe('billingSummary', () => {
  test('extracts invoice payment method and billing info from raw billing snapshot', () => {
    const summary = buildBillingSummary({
      seatTypeCounts: {
        seat_type_counts: { default: 2, usage_based: 3, automation: 0 }
      },
      invoices: {
        data: [
          {
            id: 'in_1',
            number: 'K5J6V64S-0001',
            status: 'paid',
            paid: true,
            currency: 'gbp',
            total: 1100,
            amount_due: 1100,
            amount_paid: 1100,
            subtotal: 3600,
            tax: 0,
            created: 1782199195,
            billing_reason: 'subscription_create',
            hosted_invoice_url: 'https://invoice.example/i',
            invoice_pdf: 'https://invoice.example/pdf',
            customer_name: 'Breonna Bezek',
            customer_email: 'owner@example.com',
            lines: {
              data: [
                {
                  description: '2 seat x ChatGPT Business Subscription',
                  quantity: 2,
                  amount: 3600,
                  price: { unit_amount: 1800 }
                }
              ]
            }
          }
        ]
      },
      upcomingInvoice: {
        object: 'invoice',
        status: 'draft',
        paid: false,
        billing_reason: 'upcoming',
        currency: 'gbp',
        total: 1100,
        amount_due: 1100,
        amount_paid: 0,
        amount_remaining: 1100,
        created: 1784784000,
        next_payment_attempt: 1784787600,
        lines: {
          data: [
            {
              description: '2 seat x ChatGPT Business Subscription',
              quantity: 2,
              amount: 3600,
              currency: 'gbp',
              price: { unit_amount: 1800 },
              period: { start: 1784784000, end: 1787462400 }
            }
          ]
        }
      },
      paymentMethods: {
        payment_methods: [
          {
            id: 'pm_1',
            type: 'card',
            card: { brand: 'visa', last4: '7198', exp_month: 6, exp_year: 2031 }
          }
        ],
        default_payment_method_id: 'pm_1'
      },
      billingInfo: {
        name: 'Breonna Bezek',
        address: {
          line1: '12885 Hill Pine Road',
          city: 'Midland',
          state: 'NC',
          postal_code: '28107',
          country: 'US'
        },
        tax_id: null
      }
    });

    expect(summary).not.toHaveProperty('seatCounts');
    expect(summary.invoices[0]).toMatchObject({
      id: 'in_1',
      number: 'K5J6V64S-0001',
      status: 'paid',
      paid: true,
      currency: 'gbp',
      total: 1100,
      createdAt: 1782199195000,
      lineDescription: '2 seat x ChatGPT Business Subscription',
      lineQuantity: 2,
      lineUnitAmount: 1800
    });
    expect(summary.upcomingInvoice).toMatchObject({
      status: 'draft',
      paid: false,
      billingReason: 'upcoming',
      currency: 'gbp',
      total: 1100,
      amountDue: 1100,
      amountPaid: 0,
      amountRemaining: 1100,
      nextPaymentAttempt: 1784787600000,
      lineDescription: '2 seat x ChatGPT Business Subscription',
      lineQuantity: 2,
      lineUnitAmount: 1800,
      periodStart: 1784784000000,
      periodEnd: 1787462400000
    });
    expect(summary.paymentMethods[0]).toMatchObject({
      id: 'pm_1',
      type: 'card',
      brand: 'visa',
      last4: '7198',
      expMonth: 6,
      expYear: 2031,
      isDefault: true
    });
    expect(summary.billingInfo).toEqual({
      name: 'Breonna Bezek',
      address: '12885 Hill Pine Road, Midland, NC, 28107, US',
      taxId: ''
    });
  });

  test('formats minor currency amounts', () => {
    expect(formatBillingAmount(1100, 'gbp')).toBe('£11.00');
  });
});
