import type { MemberRole, SeatType } from '@team-manager/shared';

export const SEAT_LABEL: Record<SeatType, string> = {
  default: 'ChatGPT 席位',
  usage_based: 'Codex 席位'
};

const ROLE_LABELS: Record<string, string> = {
  'account-owner': '所有者',
  'account-admin': '管理员',
  'standard-user': '成员',
  analyst: '分析者',
  'account-analyst': '分析者'
};

const PLAN_LABELS: Record<string, string> = {
  self_serve_business_usage_based: 'Codex席位',
  self_serve_business: 'Business',
  team: 'Business'
};

export function seatLabel(seat?: SeatType | null): string {
  return seat ? SEAT_LABEL[seat] : '未设置';
}

export function roleLabel(role?: MemberRole | null): string {
  return role ? ROLE_LABELS[role] ?? role : '暂无角色';
}

export function planLabel(plan?: string | null): string {
  return plan ? PLAN_LABELS[plan] ?? plan : '暂无套餐';
}
