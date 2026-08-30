import { fetchWithRawTrace } from './transport.js';
import { upstreamHttpError } from './serviceError.js';
import { isSeatType, type SeatQuantity } from '@team-manager/shared';

interface TeamCodeTaskResult {
  payUrl?: unknown;
  created?: unknown;
  expires_at?: unknown;
  country?: unknown;
  currency?: unknown;
  requestedQuantity?: unknown;
  calibration?: {
    total?: unknown;
    subtotal?: unknown;
    discount?: unknown;
    tax?: unknown;
    currency?: unknown;
    status?: unknown;
    paymentStatus?: unknown;
    automaticTaxStatus?: unknown;
    actualWorkspaceId?: unknown;
    workspaceStatus?: unknown;
    quantity?: unknown;
    seatQuantities?: unknown;
  } | null;
}

interface TeamCodeTaskState {
  status?: unknown;
  result?: TeamCodeTaskResult | null;
  error?: unknown;
}

export interface TeamCodeOrderResult {
  taskId: string;
  payUrl: string;
  stripeCreatedAt: number;
  expiresAt: number;
  orderInformation: {
    country: string;
    currency: string;
    requestedQuantity: number;
    quantity: number;
    subtotalMinor?: number;
    discountMinor?: number;
    taxMinor?: number;
    totalMinor?: number;
    seatQuantities?: SeatQuantity[];
    checkoutStatus?: string;
    paymentStatus?: string;
    automaticTaxStatus?: string;
    actualWorkspaceId?: string;
    workspaceStatus: string;
  };
}

export interface TeamCodeOrderInput {
  account: { email: string; accountId: string; accessToken: string; sessionToken?: string };
  targetWorkspaceId?: string;
  workspaceName: string;
  config: { promoCode: string; country: string; currency: string; seatQuantity: number; seatQuantities?: SeatQuantity[] };
}

export interface TeamCodeGateway {
  readonly configured: boolean;
  generateOrder(input: TeamCodeOrderInput): Promise<TeamCodeOrderResult>;
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readNumber(value: unknown, fallback?: number): number {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) return parsed;
  if (fallback !== undefined) return fallback;
  throw new Error('TeamCode 返回的订单金额或席位数无效');
}

function errorMessage(body: unknown, fallback: string): string {
  const record = readObject(body);
  return readString(record.error) || readString(record.message) || fallback;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TeamCodeClient implements TeamCodeGateway {
  readonly configured: boolean;
  private readonly baseUrl: string;
  private readonly passcode: string;

  constructor(baseUrl?: string, passcode?: string) {
    this.baseUrl = (baseUrl ?? '').trim().replace(/\/$/, '');
    this.passcode = (passcode ?? '').trim();
    this.configured = Boolean(this.baseUrl && this.passcode);
  }

  async generateOrder(input: TeamCodeOrderInput): Promise<TeamCodeOrderResult> {
    if (!this.configured) throw new Error('TeamCode 服务尚未配置');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7 * 60_000);
    timeout.unref?.();
    try {
      const submitResponse = await fetchWithRawTrace('team-code', `${this.baseUrl}/api/order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Passcode': this.passcode
        },
        body: JSON.stringify(teamCodeOrderPayload(input)),
        signal: controller.signal
      });
      const submitBody = await submitResponse.json().catch(() => ({}));
      if (!submitResponse.ok) {
        throw upstreamHttpError(
          submitResponse.status,
          errorMessage(submitBody, `TeamCode 提交失败（HTTP ${submitResponse.status}）`)
        );
      }
      const taskId = readString(readObject(submitBody).id);
      if (!taskId) throw new Error('TeamCode 提交成功但未返回任务 ID');

      while (true) {
        await wait(2_000);
        const response = await fetchWithRawTrace(
          'team-code',
          `${this.baseUrl}/api/tasks?ids=${encodeURIComponent(taskId)}`,
          {
            headers: { 'X-Passcode': this.passcode },
            signal: controller.signal
          }
        );
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw upstreamHttpError(
            response.status,
            errorMessage(body, `TeamCode 查询失败（HTTP ${response.status}）`)
          );
        }
        const states = readObject(body).states;
        const state = Array.isArray(states) ? states[0] as TeamCodeTaskState | undefined : undefined;
        const status = readString(state?.status);
        if (status === 'queued' || status === 'running') continue;
        if (status === 'failed' || status === 'canceled' || status === 'unknown') {
          throw new Error(readString(state?.error) || `TeamCode 任务状态异常：${status || '空'}`);
        }
        if (status !== 'done') throw new Error(`TeamCode 返回未知任务状态：${status || '空'}`);

        const result = state?.result;
        const payUrl = readString(result?.payUrl);
        const created = Number(result?.created);
        const expiresAt = Number(result?.expires_at);
        const orderInformation = result?.calibration;
        const workspaceStatus = readString(orderInformation?.workspaceStatus) || 'unknown';
        if (workspaceStatus === 'mismatch') {
          throw new Error('订单信息显示绑定的 Workspace 与目标 Workspace 不匹配，已拒绝返回付款链接');
        }
        if (!payUrl) throw new Error('TeamCode 任务完成但未返回支付 URL');
        if (!Number.isFinite(created) || created <= 0) throw new Error('TeamCode 任务未返回 Stripe created');
        if (!Number.isFinite(expiresAt) || expiresAt <= created) {
          throw new Error('TeamCode 任务未返回有效的 Stripe expires_at');
        }
        if (!orderInformation) throw new Error('TeamCode 任务完成但未返回订单信息');
        const requestedQuantity = readNumber(result?.requestedQuantity, input.config.seatQuantity);
        const totalRaw = Number(orderInformation.total);
        const totalMinor = Number.isFinite(totalRaw) ? totalRaw : undefined;
        const seatQuantities = normalizeSeatQuantities(orderInformation.seatQuantities, input.config.seatQuantities ?? [{ seatType: 'default', quantity: requestedQuantity }]);
        return {
          taskId,
          payUrl,
          stripeCreatedAt: created * 1000,
          expiresAt: expiresAt * 1000,
          orderInformation: {
            country: readString(result?.country) || input.config.country,
            currency: readString(orderInformation.currency) || readString(result?.currency) || input.config.currency,
            requestedQuantity,
            quantity: readNumber(orderInformation.quantity, requestedQuantity),
            ...(Number.isFinite(Number(orderInformation.subtotal)) ? { subtotalMinor: Number(orderInformation.subtotal) } : {}),
            ...(Number.isFinite(Number(orderInformation.discount)) ? { discountMinor: Number(orderInformation.discount) } : {}),
            ...(Number.isFinite(Number(orderInformation.tax)) ? { taxMinor: Number(orderInformation.tax) } : {}),
            ...(totalMinor === undefined ? {} : { totalMinor }),
            seatQuantities,
            ...(readString(orderInformation.status) ? { checkoutStatus: readString(orderInformation.status) } : {}),
            ...(readString(orderInformation.paymentStatus) ? { paymentStatus: readString(orderInformation.paymentStatus) } : {}),
            ...(readString(orderInformation.automaticTaxStatus) ? { automaticTaxStatus: readString(orderInformation.automaticTaxStatus) } : {}),
            ...(readString(orderInformation.actualWorkspaceId) ? { actualWorkspaceId: readString(orderInformation.actualWorkspaceId) } : {}),
            workspaceStatus
          }
        };
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') throw new Error('TeamCode 订单生成超时');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function teamCodeOrderPayload(input: TeamCodeOrderInput) {
  return {
    session: {
      user: { email: input.account.email },
      account: { id: input.account.accountId },
      accessToken: input.account.accessToken,
      ...(input.account.sessionToken ? { sessionToken: input.account.sessionToken } : {})
    },
    order: {
      mode: 'normal',
      seatQuantity: input.config.seatQuantity,
      ...(input.config.seatQuantities ? { seatQuantities: input.config.seatQuantities } : {}),
      workspaceId: input.targetWorkspaceId ?? '',
      workspaceName: input.workspaceName,
      promoCode: input.config.promoCode,
      country: input.config.country,
      currency: input.config.currency
    }
  };
}

function normalizeSeatQuantities(value: unknown, fallback: SeatQuantity[]): SeatQuantity[] {
  const rows = Array.isArray(value) ? value : fallback;
  const result: SeatQuantity[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const source = row as Record<string, unknown>;
    const seatType = source.seatType ?? source.seat_type;
    const quantity = Number(source.quantity);
    if (!isSeatType(seatType) || !Number.isSafeInteger(quantity) || quantity < 0) continue;
    const existing = result.find((item) => item.seatType === seatType);
    if (existing) existing.quantity += quantity;
    else result.push({ seatType, quantity });
  }
  return result.length ? result : fallback;
}
