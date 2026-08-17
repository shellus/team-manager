import type { AccountManagerOperationView } from '@team-manager/shared';

const ACTIVE = new Set(['queued', 'running', 'waiting_for_otp', 'waiting_manual']);
const PAYMENT_TYPES = new Set([
  'change_personal_subscription',
  'open_business_subscription',
  'add_personal_payment_method',
  'add_subscription_payment_method',
]);
const BROWSER_RECOVERY_TYPES = new Set([
  'register_account',
  'change_personal_subscription',
  'open_business_subscription',
  'add_personal_payment_method',
  'add_subscription_payment_method',
]);

export function operationTypeLabel(value: string): string {
  return ({
    register_account: '注册账号',
    import_account: '纳入 GAM',
    change_personal_subscription: '个人套餐',
    cancel_personal_subscription_renewal: '取消续费',
    open_business_subscription: 'Business 套餐',
    add_personal_payment_method: '绑定支付方式',
    add_subscription_payment_method: '绑定支付方式',
  } as Record<string, string>)[value] ?? readableOperationCode(value);
}

export function operationPhaseLabel(value: string): string {
  return ({
    queued: '等待开始',
    running: '正在执行',
    waiting_for_otp: '等待验证码',
    waiting_manual: '等待人工处理',
    complete: '已完成',
    succeeded: '已完成',
    failed: '执行失败',
    interrupted: '已中断',
    already_effective: '目标套餐已生效',
    payment_card_required: '需要补充支付卡',
    pro5x_payment_card_required: '需要补充支付卡',
  } as Record<string, string>)[value] ?? readableOperationCode(value);
}

export function operationDrawerActions(operation: AccountManagerOperationView) {
  const active = ACTIVE.has(operation.status);
  const terminal = !active;
  const recoverable = BROWSER_RECOVERY_TYPES.has(operation.type)
    && ['failed', 'waiting_manual'].includes(operation.status);
  const cardRequired = PAYMENT_TYPES.has(operation.type) && [
    operation.phase,
    operation.errorCode,
  ].some((value) => /card|payment_method|required/i.test(value ?? ''));
  return {
    retry: recoverable,
    rotateIp: recoverable,
    terminate: active,
    supplyCard: cardRequired,
    editRegistrationProxy: operation.type === 'register_account' && operation.status !== 'succeeded',
    remove: terminal,
  };
}

function readableOperationCode(value: string): string {
  return value ? value.replaceAll('_', ' ') : '—';
}
