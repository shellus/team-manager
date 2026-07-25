import type { MaintainedTeamOrder } from '@team-manager/shared';
import { Tag } from 'antd';
import { presentedTeamOrderStatus } from './teamOrderPresentation.js';

const labels = {
  queued: '排队中',
  running: '生成中',
  ready: '可支付',
  expiring: '即将过期',
  expired: '已过期',
  failed: '生成失败'
} as const;

const colors = {
  queued: 'default',
  running: 'processing',
  ready: 'success',
  expiring: 'warning',
  expired: 'default',
  failed: 'error'
} as const;

export function TeamOrderStatusTag({ order, now }: { order: MaintainedTeamOrder; now?: number }) {
  const status = presentedTeamOrderStatus(order, now);
  return <Tag color={colors[status]}>{labels[status]}</Tag>;
}
