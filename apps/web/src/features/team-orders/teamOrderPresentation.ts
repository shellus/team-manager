import type { MaintainedTeamOrder } from '@team-manager/shared';

export type PresentedTeamOrderStatus = MaintainedTeamOrder['status'] | 'expiring' | 'expired';
export type TeamOrderRetryMode = 'expedite' | 'regenerate';

export function presentedTeamOrderStatus(order: MaintainedTeamOrder, now = Date.now()): PresentedTeamOrderStatus {
  if (order.status !== 'ready' || !order.expiresAt) return order.status;
  if (order.expiresAt <= now) return 'expired';
  if (order.expiresAt - now <= 2 * 60 * 60_000) return 'expiring';
  return 'ready';
}

export function teamOrderRemainingText(expiresAt: number | undefined, now = Date.now()): string {
  if (!expiresAt) return '暂无';
  const remaining = expiresAt - now;
  if (remaining <= 0) return '已过期';
  const totalMinutes = Math.ceil(remaining / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours >= 24) return `${Math.floor(hours / 24)}天${hours % 24}小时`;
  if (hours > 0) return `${hours}小时${minutes}分钟`;
  return `${minutes}分钟`;
}

export function teamOrderSourceLabel(source: MaintainedTeamOrder['source']): string {
  if (source === 'scheduled') return '周期任务';
  if (source === 'manual_all') return '批量手动';
  return '单个手动';
}

export function teamOrderRetryMode(order: MaintainedTeamOrder): TeamOrderRetryMode | null {
  if (order.status === 'queued' && order.attemptCount > 0 && order.retryAt) return 'expedite';
  if (order.status === 'failed') return 'regenerate';
  return null;
}
