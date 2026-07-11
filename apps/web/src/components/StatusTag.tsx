import type {
  AccountLimitType,
  MemberRole,
  SeatType,
  SubaccountStatus
} from '@team-manager/shared';
import { Tag } from 'antd';
import { limitTypeLabel, roleLabel, seatLabel } from '../labels.js';

const SUBACCOUNT_STATUS_LABEL: Record<SubaccountStatus, string> = {
  empty: '未录入',
  session_ready: 'Session 可用',
  codex_auth_pending: '授权中',
  codex_ready: 'Codex 可用',
  verification_required: '待验证',
  account_locked: '账号锁定',
  error: '异常'
};

const MEMBER_ROLE_TAG_COLOR: Record<string, string | undefined> = {
  'analytics-viewer': 'cyan',
  analyst: 'cyan',
  'account-analyst': 'cyan',
  'standard-user': 'green',
  'account-admin': 'gold',
  'account-owner': 'magenta'
};

export function AccountStatusTag({ status }: { status?: 'active' | 'invalid' | 'unknown' }) {
  if (status === 'active') return <Tag color="success">正常</Tag>;
  if (status === 'invalid') return <Tag color="error">失效</Tag>;
  return <Tag>待同步</Tag>;
}

export function SubaccountStatusTag({ status }: { status: SubaccountStatus }) {
  const color =
    status === 'codex_ready'
      ? 'success'
      : status === 'error' || status === 'account_locked'
        ? 'error'
        : status === 'codex_auth_pending' || status === 'verification_required'
          ? 'warning'
          : 'default';
  return <Tag color={color}>{SUBACCOUNT_STATUS_LABEL[status]}</Tag>;
}

export function SeatTag({ seat }: { seat?: SeatType }) {
  if (!seat) return <Tag>未设置</Tag>;
  return <Tag color={seat === 'default' ? 'blue' : 'purple'}>{seatLabel(seat)}</Tag>;
}

export function MemberRoleTag({ role }: { role?: MemberRole }) {
  if (!role) return <Tag>待分配</Tag>;
  return <Tag color={MEMBER_ROLE_TAG_COLOR[role]}>{roleLabel(role)}</Tag>;
}

export function DefaultSeatTag({ seat }: { seat?: SeatType }) {
  if (seat === 'usage_based') return <Tag className="default-codex-seat-tag">Codex 席位 · 绝版</Tag>;
  return <SeatTag seat={seat} />;
}

export function LimitTypeTag({ limitType }: { limitType?: AccountLimitType | null }) {
  const normalized = limitType ?? 'unknown';
  return <Tag className={`limit-type-tag limit-type-${normalized}`}>{limitTypeLabel(normalized)}</Tag>;
}

export function TeamLinkStatusTag({ status }: { status: 'invited' | 'member' | 'removed' | 'unknown' }) {
  const label = status === 'member' ? '已在 Team' : status === 'invited' ? '邀请中' : status === 'removed' ? '未找到' : '未确认';
  const color = status === 'member' ? 'success' : status === 'invited' ? 'processing' : status === 'removed' ? 'default' : 'warning';
  return <Tag color={color}>{label}</Tag>;
}

export { SUBACCOUNT_STATUS_LABEL };
