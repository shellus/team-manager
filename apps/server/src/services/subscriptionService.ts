import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type {
  AutomationOperationView,
  ChangePersonalSubscriptionRequest
} from '@team-manager/shared';
import type { Database } from '../database/schema.js';
import { AutomationOperationRepository } from '../repositories/automationOperationRepository.js';
import { ServiceError, asServiceError } from '../serviceError.js';
import { ActivityLogRepository } from '../repositories/activityLogRepository.js';
import { PersonalSpaceService } from './personalSpaceService.js';

/** 个人套餐升级：Team Manager 直连上游，使用账号当前默认支付方式；首次开通的浏览器 Checkout 已下线。 */
export class SubscriptionService {
  readonly #operations: AutomationOperationRepository;
  readonly #activity: ActivityLogRepository;
  readonly #activePersonalSubscriptionWrites = new Set<string>();

  constructor(
    db: Kysely<Database>,
    private readonly personalSpaces?: PersonalSpaceService
  ) {
    this.#operations = new AutomationOperationRepository(db);
    this.#activity = new ActivityLogRepository(db);
  }

  async changePersonalSubscription(
    accountId: string,
    input: ChangePersonalSubscriptionRequest
  ): Promise<AutomationOperationView> {
    let releaseWrite: (() => void) | undefined;
    try {
      if (!['go', 'plus', 'pro_5x', 'pro_20x'].includes(input.targetPlan)) throw new ServiceError(400, '无效的目标个人套餐');
      if (input.mode !== 'change_existing') throw new ServiceError(400, '只支持升级已付费个人套餐');
      if (!this.personalSpaces) throw new ServiceError(503, '个人空间服务未配置');
      releaseWrite = this.acquirePersonalSubscriptionWrite(accountId);
      const refreshed = await this.personalSpaces.refresh(accountId, ['subscription']);
      const current = refreshed?.subscription && 'plan' in refreshed.subscription
        ? refreshed.subscription.plan
        : undefined;
      if (current === input.targetPlan) {
        const operationId = await this.#operations.start({ accountId, kind: 'change_personal_subscription',
          idempotencyKey: randomUUID(), safeRequestSummary: safeSubscriptionRequest(input) });
        await this.#operations.completeLocal(operationId, { phase: 'already_effective',
          result: { targetPlan: input.targetPlan, effectiveAt: new Date().toISOString(), idempotent: true } });
        await this.#activity.log({accountId,kind:'personal_subscription_unchanged',payload:{operationId,targetPlan:input.targetPlan}});
        return this.#operations.view(operationId);
      }
      if (input.autoPay !== true) throw new ServiceError(400, '套餐升级会立即扣款，请确认自动提交付款');
      const operationId = await this.#operations.start({
        accountId,
        kind: 'change_personal_subscription',
        idempotencyKey: randomUUID(),
        safeRequestSummary: safeSubscriptionRequest(input)
      });
      try {
        const { detail, preview } = await this.personalSpaces.upgradeSubscription(accountId, input.targetPlan);
        const subscription = detail.subscription;
        const effectiveAt = subscription && 'effectiveAt' in subscription
          ? subscription.effectiveAt
          : new Date().toISOString();
        await this.#operations.completeLocal(operationId, {
          phase: 'personal_subscription_upgrade_verified',
          result: {
            targetPlan: input.targetPlan,
            effectiveAt,
            amount: formatMinorAmount(preview.amountDueMinor, preview.currency),
            currency: preview.currency,
            ...(preview.defaultPaymentMethod ? {
              cardBrand: preview.defaultPaymentMethod.brand,
              cardLast4: preview.defaultPaymentMethod.last4
            } : {})
          }
        });
        await this.#activity.log({
          accountId,
          kind: 'personal_subscription_requested',
          payload: { operationId, targetPlan: input.targetPlan, mode: input.mode }
        });
        return this.#operations.view(operationId);
      } catch (error) {
        await this.#operations.failLocal(operationId, {
          phase: 'personal_subscription_upgrade_failed',
          errorCode: 'personal_subscription_upgrade_failed',
          errorMessage: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    } catch (error) { throw asServiceError(error); }
    finally { releaseWrite?.(); }
  }

  async previewPersonalSubscriptionChange(
    accountId: string,
    targetPlan: ChangePersonalSubscriptionRequest['targetPlan']
  ) {
    if (!['go', 'plus', 'pro_5x', 'pro_20x'].includes(targetPlan)) {
      throw new ServiceError(400, '无效的目标个人套餐');
    }
    if (!this.personalSpaces) throw new ServiceError(503, '个人空间服务未配置');
    return this.personalSpaces.previewSubscriptionChange(accountId, targetPlan);
  }

  private acquirePersonalSubscriptionWrite(accountId: string): () => void {
    if (this.#activePersonalSubscriptionWrites.has(accountId)) {
      throw new ServiceError(409, '该账号已有个人套餐写入请求正在进行');
    }
    this.#activePersonalSubscriptionWrites.add(accountId);
    return () => this.#activePersonalSubscriptionWrites.delete(accountId);
  }
}

function safeSubscriptionRequest(input: ChangePersonalSubscriptionRequest) {
  return { mode: input.mode, targetPlan: input.targetPlan, autoPay: input.autoPay, paymentMethod: 'saved' };
}

function formatMinorAmount(amountMinor: number, currency: string): string {
  let fractionDigits = 2;
  try {
    fractionDigits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    // ISO 4217 currencies normally use two fraction digits; keep that as the display fallback.
  }
  return (amountMinor / (10 ** fractionDigits)).toFixed(fractionDigits);
}
