import type { Kysely } from 'kysely';
import {
  CHECKOUT_COUNTRY_CODES,
  CHECKOUT_CURRENCIES,
  type GenerateWorkspaceOrderLinkRequest,
  type WorkspaceOrderLinkView
} from '@team-manager/shared';
import { isSeatType, type SeatQuantity } from '@team-manager/shared';
import type { Database } from '../database/schema.js';
import { ActivityLogRepository } from '../repositories/activityLogRepository.js';
import { WorkspaceRepository } from '../repositories/workspaceRepository.js';
import { ServiceError, asServiceError } from '../serviceError.js';
import type { TeamCodeGateway } from '../teamCodeClient.js';

interface CheckoutSessionProvider {
  checkoutSession(accountId: string): Promise<{
    email: string;
    accountId: string;
    accessToken: string;
    sessionToken?: string;
  }>;
}

const checkoutCountries = new Set<string>(CHECKOUT_COUNTRY_CODES);
const checkoutCurrencies = new Set<string>(CHECKOUT_CURRENCIES);

export class WorkspaceOrderLinkService {
  readonly #activity: ActivityLogRepository;
  readonly #workspaces: WorkspaceRepository;

  constructor(
    private readonly db: Kysely<Database>,
    private readonly sessions: CheckoutSessionProvider,
    private readonly gateway: TeamCodeGateway
  ) {
    this.#activity = new ActivityLogRepository(db);
    this.#workspaces = new WorkspaceRepository(db);
  }

  async generate(accountId: string, input: GenerateWorkspaceOrderLinkRequest): Promise<WorkspaceOrderLinkView> {
    const mode = input.mode;
    if (!['create_workspace', 'upgrade_existing_workspace'].includes(mode)) {
      throw new ServiceError(400, '无效的 Workspace 订单类型');
    }
    const country = input.country?.trim().toUpperCase() ?? '';
    const currency = input.currency?.trim().toUpperCase() ?? '';
    const seatQuantities = normalizeSeatQuantities(input.seatQuantities, input.seatQuantity);
    const seatQuantity = seatQuantities.reduce((sum, item) => sum + item.quantity, 0);
    const promoCode = input.promoCode?.trim() ?? '';
    if (!checkoutCountries.has(country)) throw new ServiceError(400, '请选择有效的 Checkout 国家');
    if (!checkoutCurrencies.has(currency)) throw new ServiceError(400, '请选择有效的 Checkout 货币');
    if (!Number.isSafeInteger(seatQuantity) || seatQuantity < 0) {
      throw new ServiceError(400, 'Workspace 订单席位数必须是非负安全整数');
    }
    if (promoCode.length > 256) throw new ServiceError(400, '优惠码长度不能超过 256 个字符');

    let workspaceId: string | undefined;
    let targetWorkspaceId: string | undefined;
    let workspaceName: string;
    if (mode === 'upgrade_existing_workspace') {
      if (!input.workspaceId?.trim()) throw new ServiceError(400, '请选择要升级的 Workspace');
      await this.#workspaces.requireManageableBy(input.workspaceId, accountId);
      const workspace = await this.#workspaces.findById(input.workspaceId);
      if (!workspace) throw new ServiceError(404, 'Workspace 不存在');
      workspaceId = workspace.id;
      targetWorkspaceId = workspace.external_id;
      workspaceName = workspace.name?.trim() || 'Workspace';
    } else {
      if (input.workspaceId?.trim()) throw new ServiceError(400, '新开空间不应提供已有 Workspace');
      workspaceName = input.workspaceName?.trim() ?? '';
      if (!workspaceName) throw new ServiceError(400, '请输入新 Workspace 名称');
      if (workspaceName.length > 128) throw new ServiceError(400, 'Workspace 名称长度不能超过 128 个字符');
    }

    const activityPayload = {
      mode,
      workspaceName,
      ...(targetWorkspaceId ? { workspaceExternalId: targetWorkspaceId } : {}),
      country,
      currency,
      seatQuantity,
      seatQuantities,
      hasPromoCode: Boolean(promoCode)
    };

    try {
      if (!this.gateway.configured) throw new ServiceError(503, 'TeamCode 服务尚未配置，无法生成订单链接');
      const account = await this.sessions.checkoutSession(accountId);
      const result = await this.gateway.generateOrder({
        account,
        ...(targetWorkspaceId ? { targetWorkspaceId } : {}),
        workspaceName,
        config: { promoCode, country, currency, seatQuantity, seatQuantities }
      });
      const information = result.orderInformation;
      const workspaceBindingStatus = mode === 'create_workspace'
        ? 'new_workspace'
        : information.workspaceStatus === 'matched'
          ? 'matched'
          : 'unknown';
      const view: WorkspaceOrderLinkView = {
        taskId: result.taskId,
        mode,
        checkoutUrl: result.payUrl,
        workspaceName,
        ...(targetWorkspaceId ? { requestedWorkspaceId: targetWorkspaceId } : {}),
        ...(information.actualWorkspaceId ? { actualWorkspaceId: information.actualWorkspaceId } : {}),
        workspaceBindingStatus,
        requestedSeatQuantity: information.requestedQuantity,
        orderSeatQuantity: information.quantity,
        country: information.country,
        currency: information.currency,
        ...(information.subtotalMinor === undefined ? {} : { subtotalMinor: information.subtotalMinor }),
        ...(information.discountMinor === undefined ? {} : { discountMinor: information.discountMinor }),
        ...(information.taxMinor === undefined ? {} : { taxMinor: information.taxMinor }),
        ...(information.totalMinor === undefined ? {} : { totalMinor: information.totalMinor }),
        seatQuantities: information.seatQuantities ?? seatQuantities,
        ...(information.checkoutStatus ? { checkoutStatus: information.checkoutStatus } : {}),
        ...(information.paymentStatus ? { paymentStatus: information.paymentStatus } : {}),
        ...(information.automaticTaxStatus ? { automaticTaxStatus: information.automaticTaxStatus } : {}),
        createdAt: new Date(result.stripeCreatedAt).toISOString(),
        expiresAt: new Date(result.expiresAt).toISOString()
      };
      await this.#activity.log({
        accountId,
        workspaceId: workspaceId ?? null,
        kind: 'workspace_order_link_generated',
        payload: {
          ...activityPayload,
          taskId: result.taskId,
          orderSeatQuantity: information.quantity,
          totalMinor: information.totalMinor,
          orderCurrency: information.currency,
          workspaceBindingStatus
        }
      });
      return view;
    } catch (error) {
      await this.#activity.log({
        accountId,
        workspaceId: workspaceId ?? null,
        kind: 'workspace_order_link_generation_failed',
        payload: {
          ...activityPayload,
          error: error instanceof Error ? error.message : String(error)
        }
      }).catch(() => undefined);
      throw asServiceError(error);
    }
  }
}

function normalizeSeatQuantities(value: unknown, totalValue: unknown): SeatQuantity[] {
  const input = Array.isArray(value) ? value : [{ seatType: 'default' as const, quantity: Number(totalValue) }];
  const result: SeatQuantity[] = [];
  for (const row of input) {
    if (!row || typeof row !== 'object') throw new ServiceError(400, '订单席位明细无效');
    const source = row as Record<string, unknown>;
    const seatType = source.seatType ?? source.seat_type;
    const quantity = Number(source.quantity);
    if (!isSeatType(seatType) || !Number.isSafeInteger(quantity) || quantity < 0) throw new ServiceError(400, '订单席位明细无效');
    const existing = result.find((item) => item.seatType === seatType);
    if (existing) existing.quantity += quantity;
    else result.push({ seatType, quantity });
  }
  if (!result.length) throw new ServiceError(400, '订单席位明细不能为空');
  const total = result.reduce((sum, item) => sum + item.quantity, 0);
  if (Array.isArray(value) && totalValue !== undefined && (!Number.isSafeInteger(Number(totalValue)) || Number(totalValue) !== total)) {
    throw new ServiceError(400, '订单总席位数必须等于席位类型明细之和');
  }
  if (!Number.isSafeInteger(total) || total < 0) throw new ServiceError(400, 'Workspace 订单席位数必须是非负安全整数');
  return result;
}
