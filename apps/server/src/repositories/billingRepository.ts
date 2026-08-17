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
        normalized_workspace_plan: context.kind === 'workspace' ? normalizeWorkspaceBillingPlan(payload) : null,
        payload, observed_at: observedAt
      }).returning('id').executeTakeFirstOrThrow();
      const invoices = envelopeRecords(payload.invoices, ['data', 'invoices']);
      if (invoices.length) await trx.insertInto('billing_invoices').values(invoices.map((invoice) => ({
        billing_snapshot_id: row.id,
        external_id: text(invoice.id) ?? text(invoice.invoice_id) ?? null,
        amount: numberOrString(invoice.amount_due) ?? numberOrString(invoice.amount) ?? null,
        currency: text(invoice.currency) ?? null, status: text(invoice.status) ?? null,
        occurred_at: date(invoice.created) ?? date(invoice.created_at) ?? null,
        payload: invoice
      }))).execute();
      const paymentEnvelope = payload.paymentMethods ?? payload.payment_methods;
      const methods = envelopeRecords(paymentEnvelope, ['payment_methods', 'data']);
      if (paymentEnvelope !== undefined) {
        let q = trx.deleteFrom('payment_method_summaries');
        q = context.kind === 'personal' ? q.where('personal_space_id', '=', context.personalSpaceId) : q.where('workspace_id', '=', context.workspaceId);
        await q.execute();
        if (methods.length) await trx.insertInto('payment_method_summaries').values(methods.map((item) => ({
          personal_space_id: context.kind === 'personal' ? context.personalSpaceId : null,
          workspace_id: context.kind === 'workspace' ? context.workspaceId : null,
          brand: text(item.brand) ?? text(record(item.card)?.brand) ?? null,
          last4: text(item.last4) ?? text(record(item.card)?.last4) ?? null,
          expiry_month: number(item.exp_month ?? record(item.card)?.exp_month),
          expiry_year: number(item.exp_year ?? record(item.card)?.exp_year),
          is_default: item.is_default === true || item.default === true
            || text(item.id) === defaultPaymentMethodId(paymentEnvelope), observed_at: observedAt
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
    const invoiceViews = invoices.length ? invoices.map(invoiceView) : envelopeRecords(snapshot.payload.invoices, ['data','invoices']).map((item,index)=>payloadInvoiceView(item,index));
    const paymentEnvelope=snapshot.payload.paymentMethods??snapshot.payload.payment_methods;
    const paymentViews = paymentEnvelope!==undefined ? payloadPaymentMethods(snapshot.payload) : paymentMethods.map(paymentMethodView);
    return {
      observedAt: new Date(snapshot.observed_at as any).toISOString(),
      ...billingSnapshotSummary(snapshot.payload),
      invoices: invoiceViews,
      paymentMethods: paymentViews
    };
  }

  async invoice(context: BillingContext, invoiceId: string) {
    const snapshot = await this.latest(context); if (!snapshot) return undefined;
    let stored=await this.db.selectFrom('billing_invoices').selectAll().where('billing_snapshot_id', '=', snapshot.id)
      .where('external_id', '=', invoiceId).executeTakeFirst();
    if(!stored&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(invoiceId))stored=await this.db.selectFrom('billing_invoices').selectAll().where('billing_snapshot_id','=',snapshot.id).where('id','=',invoiceId).executeTakeFirst();
    if(stored)return stored;
    const payload=envelopeRecords(snapshot.payload.invoices,['data','invoices']).find(item=>text(item.id)===invoiceId||text(item.invoice_id)===invoiceId);
    return payload?{id:text(payload.id)??text(payload.invoice_id)??invoiceId,billing_snapshot_id:snapshot.id,external_id:text(payload.id)??text(payload.invoice_id)??null,amount:numberOrString(payload.amount_due)??numberOrString(payload.amount)??null,currency:text(payload.currency)??null,status:text(payload.status)??null,occurred_at:date(payload.created)??date(payload.created_at),payload,created_at:snapshot.created_at}:undefined;
  }
}

function invoiceView(item:any){return buildInvoiceView(item.payload,item.external_id??item.id);}
function payloadInvoiceView(item:Record<string,unknown>,index:number){return buildInvoiceView(item,text(item.id)??text(item.invoice_id)??`snapshot-invoice-${index}`);}
function paymentMethodView(item:any){return{id:item.id,...(item.brand?{brand:item.brand}:{}),...(item.last4?{last4:item.last4}:{}),...(item.expiry_month?{expMonth:item.expiry_month}:{}),...(item.expiry_year?{expYear:item.expiry_year}:{}),isDefault:item.is_default};}
function payloadPaymentMethods(payload:Record<string,unknown>){const envelope=payload.paymentMethods??payload.payment_methods;const defaultId=defaultPaymentMethodId(envelope);return envelopeRecords(envelope,['payment_methods','data']).map((item,index)=>{const card=record(item.card);const id=text(item.id)??`snapshot-payment-${index}`;return{id,...(text(item.brand)??text(card?.brand)?{brand:text(item.brand)??text(card?.brand)}:{}),...(text(item.last4)??text(card?.last4)?{last4:text(item.last4)??text(card?.last4)}:{}),...(number(item.exp_month??card?.exp_month)!==null?{expMonth:number(item.exp_month??card?.exp_month)!}:{}),...(number(item.exp_year??card?.exp_year)!==null?{expYear:number(item.exp_year??card?.exp_year)!}:{}),isDefault:item.is_default===true||item.default===true||id===defaultId};});}

function record(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function arrayRecords(value: unknown): Record<string, unknown>[] { return Array.isArray(value) ? value.map(record).filter(Boolean) as Record<string, unknown>[] : []; }
function envelopeRecords(value: unknown, keys: string[]): Record<string, unknown>[] {
  const direct = arrayRecords(value); if (direct.length || Array.isArray(value)) return direct;
  const object = record(value); if (!object) return [];
  for (const key of keys) { const values = arrayRecords(object[key]); if (values.length || Array.isArray(object[key])) return values; }
  return [];
}
function billingSnapshotSummary(payload:Record<string,unknown>):Pick<BillingDetailView,'upcomingInvoice'|'billingIdentity'|'seatTypeCounts'>{
  const upcoming=unwrapRecord(payload.upcomingInvoice??payload.upcoming_invoice,'upcoming_invoice');
  const billing=unwrapRecord(payload.billingInfo??payload.billing_info,'billing_info');
  const counts=unwrapRecord(payload.seatTypeCounts??payload.seat_type_counts,'seat_type_counts');
  return {
    ...(upcoming?{upcomingInvoice:buildInvoiceView(upcoming,text(upcoming.id)??'upcoming')}:{}),
    ...(billing?{billingIdentity:{
      ...(text(billing.name)?{name:text(billing.name)}:{}),
      ...(text(billing.email)?{email:text(billing.email)}:{}),
      ...(text(billing.tax_id??billing.taxId)?{taxId:text(billing.tax_id??billing.taxId)}:{}),
      ...(formatAddress(billing.address)?{address:formatAddress(billing.address)}:{})
    }}:{}),
    ...(counts?{seatTypeCounts:{
      default:number(counts.default??counts.default_seats)??0,
      usageBased:number(counts.usage_based??counts.usageBased)??0
    }}:{})
  };
}
function buildInvoiceView(item:Record<string,unknown>,fallbackId:string):BillingDetailView['invoices'][number]{
  const lines=record(item.lines);const firstLine=envelopeRecords(lines,['data'])[0];const price=record(firstLine?.price);const plan=record(firstLine?.plan);const period=record(firstLine?.period);
  const created=date(item.created??item.created_at);const next=date(item.next_payment_attempt??item.nextPaymentAttempt);
  const start=date(period?.start??item.period_start??item.periodStart);const end=date(period?.end??item.period_end??item.periodEnd);
  return {id:text(item.id)??text(item.invoice_id)??fallbackId,
    ...(text(item.number)?{number:text(item.number)}:{}),...(text(item.id)??text(item.invoice_id)?{externalId:text(item.id)??text(item.invoice_id)}:{}),
    ...numberField('total',item.total),...numberField('amountDue',item.amount_due??item.amount),...numberField('amountPaid',item.amount_paid),
    ...numberField('amountRemaining',item.amount_remaining),...numberField('subtotal',item.subtotal),...numberField('tax',item.tax),
    ...(text(item.currency)?{currency:text(item.currency)}:{}),...(text(item.status)?{status:text(item.status)}:{}),
    ...(created?{createdAt:created.toISOString()}:{}),...(next?{nextPaymentAttempt:next.toISOString()}:{}),
    ...(start?{periodStart:start.toISOString()}:{}),...(end?{periodEnd:end.toISOString()}:{}),
    ...(text(item.billing_reason)?{billingReason:text(item.billing_reason)}:{}),...(text(firstLine?.description)?{lineDescription:text(firstLine?.description)}:{}),
    ...numberField('lineQuantity',firstLine?.quantity),...numberField('lineUnitAmount',price?.unit_amount??plan?.amount),
    ...(text(item.hosted_invoice_url)?{hostedInvoiceUrl:text(item.hosted_invoice_url)}:{}),...(text(item.invoice_pdf)?{invoicePdfUrl:text(item.invoice_pdf)}:{})};
}
function numberField<K extends string>(key:K,value:unknown):Record<K,number>{const parsed=number(value);return parsed===null?{} as Record<K,number>:{[key]:parsed} as Record<K,number>;}
function unwrapRecord(value: unknown, key: string):Record<string,unknown>|undefined { const wrapper=record(value);return record(wrapper?.[key])??wrapper; }
function formatAddress(value:unknown):string|undefined{const address=record(value);if(!address)return undefined;const formatted=['line1','line2','city','state','postal_code','country'].map(key=>text(address[key])).filter(Boolean).join(', ');return formatted||undefined;}
function defaultPaymentMethodId(value: unknown): string | undefined { return text(record(value)?.default_payment_method_id); }
export function hasOutstandingInvoice(payload: Record<string, unknown>): boolean {
  return envelopeRecords(payload.invoices, ['data', 'invoices']).some((invoice) => {
    if (text(invoice.status)?.toLowerCase() !== 'open') return false;
    const outstanding = number(invoice.amount_remaining ?? invoice.amount_due ?? invoice.amount);
    return outstanding === null || outstanding > 0;
  });
}
function text(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function number(value: unknown): number | null { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function numberOrString(value: unknown): number | string | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : text(value); }
function date(value: unknown): Date | null { if (typeof value !== 'string' && typeof value !== 'number') return null; const parsed = new Date(typeof value === 'number' && value < 10_000_000_000 ? value * 1000 : value); return Number.isFinite(parsed.getTime()) ? parsed : null; }

function normalizeWorkspaceBillingPlan(payload: Record<string, unknown>): 'business' | 'unknown' {
  return containsValue(payload, 'chatgptteamplan') ? 'business' : 'unknown';
}

function containsValue(value: unknown, expected: string): boolean {
  if (typeof value === 'string') return value.toLowerCase() === expected;
  if (Array.isArray(value)) return value.some((item) => containsValue(item, expected));
  if (!value || typeof value !== 'object') return false;
  return Object.values(value as Record<string, unknown>).some((item) => containsValue(item, expected));
}
