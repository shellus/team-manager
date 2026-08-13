import { fetchWithRawTrace } from './transport.js';

interface TeamCodeTaskResult {
  payUrl?: unknown;
  created?: unknown;
  expires_at?: unknown;
  calibration?: { workspaceStatus?: unknown } | null;
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
}

export interface TeamCodeOrderInput {
  account: { email: string; accountId: string; accessToken: string; sessionToken?: string };
  workspaceName: string;
  config: { promoCode: string; country: string; currency: string };
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
        body: JSON.stringify({
          session: {
            user: { email: input.account.email },
            account: { id: input.account.accountId },
            accessToken: input.account.accessToken,
            ...(input.account.sessionToken ? { sessionToken: input.account.sessionToken } : {})
          },
          order: {
            mode: 'normal',
            seatQuantity: 2,
            workspaceId: input.account.accountId,
            workspaceName: input.workspaceName,
            promoCode: input.config.promoCode,
            country: input.config.country,
            currency: input.config.currency
          }
        }),
        signal: controller.signal
      });
      const submitBody = await submitResponse.json().catch(() => ({}));
      if (!submitResponse.ok) {
        throw new Error(errorMessage(submitBody, `TeamCode 提交失败（HTTP ${submitResponse.status}）`));
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
          throw new Error(errorMessage(body, `TeamCode 查询失败（HTTP ${response.status}）`));
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
        const workspaceStatus = readString(result?.calibration?.workspaceStatus);
        if (workspaceStatus === 'mismatch') throw new Error('TeamCode 校准发现订单 Workspace 不匹配');
        if (!payUrl) throw new Error('TeamCode 任务完成但未返回支付 URL');
        if (!Number.isFinite(created) || created <= 0) throw new Error('TeamCode 任务未返回 Stripe created');
        if (!Number.isFinite(expiresAt) || expiresAt <= created) {
          throw new Error('TeamCode 任务未返回有效的 Stripe expires_at');
        }
        return {
          taskId,
          payUrl,
          stripeCreatedAt: created * 1000,
          expiresAt: expiresAt * 1000
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
