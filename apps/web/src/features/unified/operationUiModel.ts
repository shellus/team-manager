import type { AutomationOperationView } from '@team-manager/shared';

const ACTIVE = new Set(['queued', 'running']);

export function operationTypeLabel(value: string): string {
  return ({
    change_personal_subscription: '个人套餐',
    cancel_personal_subscription_renewal: '取消续费',
  } as Record<string, string>)[value] ?? readableOperationCode(value);
}

export function operationPhaseLabel(value: string): string {
  return ({
    queued: '等待开始',
    running: '正在执行',
    complete: '已完成',
    succeeded: '已完成',
    failed: '执行失败',
    interrupted: '已中断',
    already_effective: '目标套餐已生效',
    personal_subscription_upgrade_verified: '升级已生效',
    personal_subscription_upgrade_failed: '升级失败',
  } as Record<string, string>)[value] ?? readableOperationCode(value);
}

export function operationDrawerActions(operation: AutomationOperationView) {
  return { remove: !ACTIVE.has(operation.status) };
}

function readableOperationCode(value: string): string {
  return value ? value.replaceAll('_', ' ') : '—';
}
