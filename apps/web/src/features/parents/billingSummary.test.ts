import { describe, expect, test } from 'vitest';
import { buildBillingSummary, formatBillingAmount } from './billingSummary.js';

describe('billingSummary', () => {
  test('extracts seat counts invoice payment method and billing info from raw billing snapshot', () => {
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

    expect(summary.seatCounts).toEqual([
      { key: 'default', label: 'ChatGPT', count: 2 },
      { key: 'usage_based', label: 'Codex', count: 3 },
      { key: 'automation', label: 'automation', count: 0 }
    ]);
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
