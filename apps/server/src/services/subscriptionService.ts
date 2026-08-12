import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type {
  AccountManagerOperationView,
  ChangePersonalSubscriptionRequest,
  OpenBusinessSubscriptionRequest
} from '@team-manager/shared';
import type { Database } from '../database/schema.js';
import type { AccountManagerGateway } from '../accountManagerClient.js';
import { AccountRepository } from '../repositories/accountRepository.js';
import { AutomationOperationRepository } from '../repositories/automationOperationRepository.js';
import { WorkspaceRepository } from '../repositories/workspaceRepository.js';
import { ServiceError, asServiceError } from '../serviceError.js';

export class SubscriptionService {
  readonly #accounts: AccountRepository;
  readonly #workspaces: WorkspaceRepository;
  readonly #operations: AutomationOperationRepository;

  constructor(
    private readonly db: Kysely<Database>,
    private readonly accountManager?: AccountManagerGateway
  ) {
    this.#accounts = new AccountRepository(db);
    this.#workspaces = new WorkspaceRepository(db);
    this.#operations = new AutomationOperationRepository(db);
  }

  async changePersonalSubscription(
    accountId: string,
    input: ChangePersonalSubscriptionRequest
  ): Promise<AccountManagerOperationView> {
    try {
      const accountRef = await this.accountRef(accountId);
      if (!['go', 'plus', 'pro_5x', 'pro_20x'].includes(input.targetPlan)) throw new ServiceError(400, '无效的目标个人套餐');
      if (!['start_new', 'change_existing'].includes(input.mode)) throw new ServiceError(400, '无效的个人套餐操作模式');
      validateCheckout(input);
      if (input.mode === 'change_existing') {
        throw new ServiceError(409, '现有付费套餐切换协议尚未验证，当前不能执行');
      }
      const manager = this.requireManager();
      const operationId = await this.#operations.start({
        accountId,
        kind: 'change_personal_subscription',
        idempotencyKey: randomUUID(),
        safeRequestSummary: safeSubscriptionRequest(input)
      });
      const operation = await manager.changePersonalSubscription!(accountRef, {
        ...input, requestTag: `team-manager:${operationId}`
      });
      await this.#operations.attach(operationId, operation);
      return operation;
    } catch (error) { throw asServiceError(error); }
  }

  async cancelPersonalRenewal(accountId: string): Promise<AccountManagerOperationView> {
    try {
      const accountRef = await this.accountRef(accountId);
      const manager = this.requireManager();
      const operationId = await this.#operations.start({
        accountId,
        kind: 'cancel_personal_subscription_renewal',
        idempotencyKey: randomUUID(),
        safeRequestSummary: {}
      });
      const operation = await manager.cancelPersonalSubscriptionRenewal!(accountRef, {
        requestTag: `team-manager:${operationId}`
      });
      await this.#operations.attach(operationId, operation);
      return operation;
    } catch (error) { throw asServiceError(error); }
  }

  async openBusiness(
    accountId: string,
    input: OpenBusinessSubscriptionRequest
  ): Promise<AccountManagerOperationView> {
    try {
      const accountRef = await this.accountRef(accountId);
      if (!['create_workspace', 'upgrade_existing_workspace'].includes(input.mode)) throw new ServiceError(400, '无效的 Business 操作模式');
      validateCheckout(input);
      let workspaceId: string | undefined;
      let externalWorkspaceId: string | undefined;
      if (input.mode === 'upgrade_existing_workspace') {
        if (!input.workspaceId) throw new ServiceError(400, '升级既有 Workspace 必须选择 workspaceId');
        await this.#workspaces.requireManageableBy(input.workspaceId, accountId);
        const workspace = await this.#workspaces.findById(input.workspaceId);
        if (!workspace) throw new ServiceError(404, 'Workspace 不存在');
        workspaceId = workspace.id;
        externalWorkspaceId = workspace.external_id;
      } else if (input.workspaceId) {
        throw new ServiceError(400, '创建新 Workspace 不应提供 workspaceId');
      }
      const manager = this.requireManager();
      const operationId = await this.#operations.start({
        accountId, workspaceId, kind: 'open_business_subscription', idempotencyKey: randomUUID(),
        safeRequestSummary: safeSubscriptionRequest(input)
      });
      const operation = await manager.openBusinessSubscription!(accountRef, {
        ...input,
        ...(externalWorkspaceId ? { workspaceId: externalWorkspaceId } : {}),
        requestTag: `team-manager:${operationId}`
      });
      await this.#operations.attach(operationId, operation);
      return operation;
    } catch (error) { throw asServiceError(error); }
  }

  private requireManager(): AccountManagerGateway {
    if (!this.accountManager?.changePersonalSubscription || !this.accountManager.openBusinessSubscription) {
      throw new ServiceError(503, 'GAM 套餐管理未配置');
    }
    return this.accountManager;
  }

  private async accountRef(accountId: string): Promise<string> {
    const account = await this.#accounts.findById(accountId);
    if (!account) throw new ServiceError(404, '账号不存在');
    const binding = await this.db.selectFrom('gam_bindings').select('external_account_ref')
      .where('account_id', '=', accountId).executeTakeFirst();
    if (!binding) throw new ServiceError(409, '账号尚未绑定 GAM');
    return binding.external_account_ref;
  }
}

function safeSubscriptionRequest(input: ChangePersonalSubscriptionRequest | OpenBusinessSubscriptionRequest) {
  return {
    mode: input.mode,
    country: input.country,
    currency: input.currency,
    autoPay: input.autoPay,
    ...('targetPlan' in input ? { targetPlan: input.targetPlan } : {}),
    ...('workspaceId' in input && input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    ...(input.promoCode ? { hasPromoCode: true } : {}),
    ...(input.card ? { paymentMethod: 'card_input', cardLast4: input.card.number.slice(-4) } : { paymentMethod: 'saved' })
  };
}

function validateCheckout(input: ChangePersonalSubscriptionRequest | OpenBusinessSubscriptionRequest) {
  if (!/^[A-Z]{2}$/.test(input.country?.trim().toUpperCase() ?? '')) throw new ServiceError(400, 'country 应为两位国家代码');
  if (!/^[A-Z]{3}$/.test(input.currency?.trim().toUpperCase() ?? '')) throw new ServiceError(400, 'currency 应为三位货币代码');
  if (input.card) {
    if (!/^\d{12,19}$/.test(input.card.number.replaceAll(' ', ''))) throw new ServiceError(400, '卡号格式无效');
    if (input.card.expiryMonth < 1 || input.card.expiryMonth > 12 || input.card.expiryYear < new Date().getUTCFullYear()) throw new ServiceError(400, '卡片有效期无效');
    if (!/^\d{3,4}$/.test(input.card.cvc)) throw new ServiceError(400, 'CVC 格式无效');
  }
}
