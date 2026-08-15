import { EDITABLE_MEMBER_ROLES } from '@team-manager/shared';
import type {
  AccountLimitType,
  EditableMemberRole,
  MemberRole,
  SeatType
} from '@team-manager/shared';

export const SEAT_LABEL: Record<SeatType, string> = {
  default: 'ChatGPT 席位',
  usage_based: 'Codex 席位'
};

export const SEAT_OPTIONS: Array<{ value: SeatType; label: string }> = [
  { value: 'usage_based', label: SEAT_LABEL.usage_based },
  { value: 'default', label: SEAT_LABEL.default }
];

export const LIMIT_TYPE_LABEL: Record<AccountLimitType, string> = {
  unknown: '未知',
  weekly: '周限',
  monthly: '月限'
};

const ROLE_LABELS: Record<string, string> = {
  owner: '所有者',
  admin: '管理员',
  member: '成员',
  analytics_viewer: '分析者',
  unknown: '未知角色',
  'account-owner': '所有者',
  'account-admin': '管理员',
  'standard-user': '成员',
  'analytics-viewer': '分析者',
  analyst: '分析者',
  'account-analyst': '分析者'
};

const PLAN_LABELS: Record<string, string> = {
  free: 'Free',
  go: 'Go',
  plus: 'Plus',
  pro_5x: 'Pro 5x',
  pro_20x: 'Pro 20x',
  business: 'Business 双席位',
  business_usage_based: 'Business 0.52',
  unknown: '未知套餐',
  self_serve_business_usage_based: 'Codex席位',
  self_serve_business: 'Business',
  team: 'Business'
};

const STATUS_LABELS:Record<string,string>={active:'生效中',inactive:'未生效',unknown:'未知',pending:'待接受',revoked:'已撤销',removed:'已移除',empty:'空置',invited:'已邀请',member:'已绑定成员',disabled:'已停用',error:'错误',success:'成功',unavailable:'不可用'};

export function seatLabel(seat?: SeatType | null): string {
  return seat ? SEAT_LABEL[seat] : '未设置';
}

export function limitTypeLabel(limitType?: AccountLimitType | null): string {
  return LIMIT_TYPE_LABEL[limitType ?? 'unknown'];
}

export function roleLabel(role?: MemberRole | null): string {
  return role ? ROLE_LABELS[role] ?? role : '暂无角色';
}

export function editableMemberRoleOptions(currentRole: MemberRole) {
  const supported = EDITABLE_MEMBER_ROLES.map((role) => ({
    value: role,
    label: roleLabel(role)
  }));
  if ((EDITABLE_MEMBER_ROLES as readonly string[]).includes(currentRole)) return supported;
  return [{ value: currentRole, label: roleLabel(currentRole), disabled: true }, ...supported];
}

export function planLabel(plan?: string | null): string {
  return plan ? PLAN_LABELS[plan] ?? plan : '暂无套餐';
}

export function statusLabel(status?:string|null):string{return status?STATUS_LABELS[status]??status:'未知';}
