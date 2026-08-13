import type { Kysely } from 'kysely';
import type { Database } from '../database/schema.js';
import type { BillingDetailView } from '@team-manager/shared';

export type BillingContext =
  | { kind: 'personal'; personalSpaceId: string }
  | { kind: 'workspace'; workspaceId: string };

export class BillingRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async saveSnapshot(context: BillingContext, payload: Record<string, unknown>, observedAt: Date | string): Promise<string> {
    return this.db.transaction().execute(async (trx) => {
      const row = await trx.insertInto('billing_snapshots').values({
        personal_space_id: context.kind === 'personal' ? context.personalSpaceId : null,
        workspace_id: context.kind === 'workspace' ? context.workspaceId : null,
        payload, observed_at: observedAt
      }).returning('id').executeTakeFirstOrThrow();
      const invoices = arrayRecords(payload.invoices);
      if (invoices.length) await trx.insertInto('billing_invoices').values(invoices.map((invoice) => ({
        billing_snapshot_id: row.id,
        external_id: text(invoice.id) ?? text(invoice.invoice_id) ?? null,
        amount: numberOrString(invoice.amount_due) ?? numberOrString(invoice.amount) ?? null,
        currency: text(invoice.currency) ?? null, status: text(invoice.status) ?? null,
        occurred_at: date(invoice.created) ?? date(invoice.created_at) ?? null,
        payload: invoice
      }))).execute();
      const methods = arrayRecords(payload.paymentMethods ?? payload.payment_methods);
      if (methods.length) {
        let q = trx.deleteFrom('payment_method_summaries');
        q = context.kind === 'personal' ? q.where('personal_space_id', '=', context.personalSpaceId) : q.where('workspace_id', '=', context.workspaceId);
        await q.execute();
        await trx.insertInto('payment_method_summaries').values(methods.map((item) => ({
          personal_space_id: context.kind === 'personal' ? context.personalSpaceId : null,
          workspace_id: context.kind === 'workspace' ? context.workspaceId : null,
          brand: text(item.brand) ?? text(record(item.card)?.brand) ?? null,
          last4: text(item.last4) ?? text(record(item.card)?.last4) ?? null,
          expiry_month: number(item.exp_month ?? record(item.card)?.exp_month),
          expiry_year: number(item.exp_year ?? record(item.card)?.exp_year),
          is_default: item.is_default === true || item.default === true, observed_at: observedAt
        }))).execute();
      }
      return row.id;
    });
  }

  latest(context: BillingContext) {
    let query = this.db.selectFrom('billing_snapshots').selectAll();
    query = context.kind === 'personal'
      ? query.where('personal_space_id', '=', context.personalSpaceId).where('workspace_id', 'is', null)
      : query.where('workspace_id', '=', context.workspaceId).where('personal_space_id', 'is', null);
    return query.orderBy('observed_at', 'desc').executeTakeFirst();
  }

  async detail(context: BillingContext): Promise<BillingDetailView | undefined> {
    const snapshot = await this.latest(context); if (!snapshot) return undefined;
    const [invoices, paymentMethods] = await Promise.all([
      this.db.selectFrom('billing_invoices').selectAll().where('billing_snapshot_id', '=', snapshot.id).orderBy('occurred_at', 'desc').execute(),
      context.kind === 'personal'
        ? this.db.selectFrom('payment_method_summaries').selectAll().where('personal_space_id', '=', context.personalSpaceId).execute()
        : this.db.selectFrom('payment_method_summaries').selectAll().where('workspace_id', '=', context.workspaceId).execute()
    ]);
    return {
      payload: snapshot.payload, observedAt: new Date(snapshot.observed_at as any).toISOString(),
      invoices: invoices.map((item) => ({ id: item.id, ...(item.external_id ? { externalId: item.external_id } : {}),
        ...(item.amount !== null ? { amount: String(item.amount) } : {}), ...(item.currency ? { currency: item.currency } : {}),
        ...(item.status ? { status: item.status } : {}), ...(item.occurred_at ? { occurredAt: new Date(item.occurred_at as any).toISOString() } : {}), payload: item.payload })),
      paymentMethods: paymentMethods.map((item) => ({ id: item.id, ...(item.brand ? { brand: item.brand } : {}),
        ...(item.last4 ? { last4: item.last4 } : {}), ...(item.expiry_month ? { expMonth: item.expiry_month } : {}),
        ...(item.expiry_year ? { expYear: item.expiry_year } : {}), isDefault: item.is_default })),
      summary: { seatTypeCounts: snapshot.payload.seatTypeCounts ?? snapshot.payload.seat_type_counts,
        billingInfo: snapshot.payload.billingInfo ?? snapshot.payload.billing_info,
        upcomingInvoice: snapshot.payload.upcomingInvoice ?? snapshot.payload.upcoming_invoice }
    };
  }

  async invoice(context: BillingContext, invoiceId: string) {
    const snapshot = await this.latest(context); if (!snapshot) return undefined;
    return this.db.selectFrom('billing_invoices').selectAll().where('billing_snapshot_id', '=', snapshot.id)
      .where((eb) => eb.or([eb('id', '=', invoiceId), eb('external_id', '=', invoiceId)])).executeTakeFirst();
  }
}

function record(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function arrayRecords(value: unknown): Record<string, unknown>[] { return Array.isArray(value) ? value.map(record).filter(Boolean) as Record<string, unknown>[] : []; }
function text(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function number(value: unknown): number | null { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function numberOrString(value: unknown): number | string | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : text(value); }
function date(value: unknown): Date | null { if (typeof value !== 'string' && typeof value !== 'number') return null; const parsed = new Date(typeof value === 'number' && value < 10_000_000_000 ? value * 1000 : value); return Number.isFinite(parsed.getTime()) ? parsed : null; }
