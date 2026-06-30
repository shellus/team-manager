export interface BillingSeatCount {
  key: string;
  label: string;
  count: number;
}

export interface BillingInvoiceSummary {
  id: string;
  number: string;
  status: string;
  paid?: boolean;
  currency: string;
  total?: number;
  amountDue?: number;
  amountPaid?: number;
  subtotal?: number;
  tax?: number;
  createdAt?: number;
  periodStart?: number;
  periodEnd?: number;
  billingReason: string;
  hostedInvoiceUrl: string;
  invoicePdfUrl: string;
  customerName: string;
  customerEmail: string;
  lineDescription: string;
  lineQuantity?: number;
  lineAmount?: number;
  lineUnitAmount?: number;
}

export interface BillingPaymentMethodSummary {
  id: string;
  type: string;
  brand: string;
  last4: string;
  expMonth?: number;
  expYear?: number;
  isDefault: boolean;
}

export interface BillingInfoSummary {
  name: string;
  address: string;
  taxId: string;
}

export interface BillingSummary {
  seatCounts: BillingSeatCount[];
  invoices: BillingInvoiceSummary[];
  paymentMethods: BillingPaymentMethodSummary[];
  billingInfo: BillingInfoSummary;
}

const SEAT_COUNT_LABELS: Record<string, string> = {
  default: 'ChatGPT',
  usage_based: 'Codex'
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function readRecord(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const child = value[key];
  return isRecord(child) ? child : undefined;
}

function readArray(value: unknown, key: string): unknown[] {
  if (!isRecord(value)) return [];
  const child = value[key];
  return Array.isArray(child) ? child : [];
}

function readString(value: unknown, key: string): string {
  if (!isRecord(value)) return '';
  const child = value[key];
  return typeof child === 'string' ? child : '';
}

function readNumber(value: unknown, key: string): number | undefined {
  if (!isRecord(value)) return undefined;
  const child = value[key];
  return typeof child === 'number' && Number.isFinite(child) ? child : undefined;
}

function readBoolean(value: unknown, key: string): boolean | undefined {
  if (!isRecord(value)) return undefined;
  const child = value[key];
  return typeof child === 'boolean' ? child : undefined;
}

function unixSecondsToMillis(value?: number): number | undefined {
  return value === undefined ? undefined : value * 1000;
}

function formatAddress(address: unknown): string {
  if (!isRecord(address)) return '';
  return ['line1', 'line2', 'city', 'state', 'postal_code', 'country']
    .map((key) => readString(address, key))
    .filter(Boolean)
    .join(', ');
}

export function formatBillingAmount(amount?: number, currency?: string): string {
  if (amount === undefined || !currency) return '暂无';
  try {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency: currency.toUpperCase()
    }).format(amount / 100);
  } catch {
    return `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function buildSeatCounts(raw: unknown): BillingSeatCount[] {
  const seatCounts = readRecord(raw, 'seat_type_counts') ?? (isRecord(raw) ? raw : {});
  return Object.entries(seatCounts)
    .filter(([, count]) => typeof count === 'number' && Number.isFinite(count))
    .map(([key, count]) => ({
      key,
      label: SEAT_COUNT_LABELS[key] ?? key,
      count: count as number
    }));
}

function buildInvoices(raw: unknown): BillingInvoiceSummary[] {
  return readArray(raw, 'data')
    .filter(isRecord)
    .map((invoice) => {
      const lines = readRecord(invoice, 'lines');
      const firstLine = readArray(lines, 'data').find(isRecord);
      const price = readRecord(firstLine, 'price');
      const plan = readRecord(firstLine, 'plan');
      const period = readRecord(firstLine, 'period');

      return {
        id: readString(invoice, 'id'),
        number: readString(invoice, 'number'),
        status: readString(invoice, 'status'),
        paid: readBoolean(invoice, 'paid'),
        currency: readString(invoice, 'currency'),
        total: readNumber(invoice, 'total'),
        amountDue: readNumber(invoice, 'amount_due'),
        amountPaid: readNumber(invoice, 'amount_paid'),
        subtotal: readNumber(invoice, 'subtotal'),
        tax: readNumber(invoice, 'tax'),
        createdAt: unixSecondsToMillis(readNumber(invoice, 'created')),
        billingReason: readString(invoice, 'billing_reason'),
        hostedInvoiceUrl: readString(invoice, 'hosted_invoice_url'),
        invoicePdfUrl: readString(invoice, 'invoice_pdf'),
        customerName: readString(invoice, 'customer_name'),
        customerEmail: readString(invoice, 'customer_email'),
        lineDescription: readString(firstLine, 'description'),
        lineQuantity: readNumber(firstLine, 'quantity'),
        lineAmount: readNumber(firstLine, 'amount'),
        lineUnitAmount: readNumber(price, 'unit_amount') ?? readNumber(plan, 'amount'),
        periodStart: unixSecondsToMillis(readNumber(period, 'start')) ?? unixSecondsToMillis(readNumber(invoice, 'period_start')),
        periodEnd: unixSecondsToMillis(readNumber(period, 'end')) ?? unixSecondsToMillis(readNumber(invoice, 'period_end'))
      };
    });
}

function buildPaymentMethods(raw: unknown): BillingPaymentMethodSummary[] {
  const defaultPaymentMethodId = readString(raw, 'default_payment_method_id');
  const methods = readArray(raw, 'payment_methods').length > 0 ? readArray(raw, 'payment_methods') : readArray(raw, 'data');
  return methods.filter(isRecord).map((method) => {
    const card = readRecord(method, 'card');
    const id = readString(method, 'id');
    return {
      id,
      type: readString(method, 'type'),
      brand: readString(card, 'brand'),
      last4: readString(card, 'last4'),
      expMonth: readNumber(card, 'exp_month'),
      expYear: readNumber(card, 'exp_year'),
      isDefault: Boolean(defaultPaymentMethodId && id === defaultPaymentMethodId)
    };
  });
}

function buildBillingInfo(raw: unknown): BillingInfoSummary {
  return {
    name: readString(raw, 'name'),
    address: formatAddress(readRecord(raw, 'address')),
    taxId: readString(raw, 'tax_id')
  };
}

export function buildBillingSummary(raw: unknown): BillingSummary {
  return {
    seatCounts: buildSeatCounts(readRecord(raw, 'seatTypeCounts')),
    invoices: buildInvoices(readRecord(raw, 'invoices')),
    paymentMethods: buildPaymentMethods(readRecord(raw, 'paymentMethods')),
    billingInfo: buildBillingInfo(readRecord(raw, 'billingInfo'))
  };
}
