import type {
  AccountLimitType,
  AccountSeatSlotStatus,
  MemberRole,
  SeatType
} from '@team-manager/shared';
import { Tag } from 'antd';
import { limitTypeLabel, roleLabel, seatLabel } from '../labels.js';

const MEMBER_ROLE_TAG_COLOR: Record<string, string | undefined> = {
  'analytics-viewer': 'cyan',
  analyst: 'cyan',
  'account-analyst': 'cyan',
  'standard-user': 'green',
  'account-admin': 'gold',
  'account-owner': 'magenta'
};

const SEAT_SLOT_STATUS_LABEL: Record<AccountSeatSlotStatus, string> = {
  empty: '空位',
  invited: '邀请中',
  member: '成员',
  unknown: '关系失联'
};

const SEAT_SLOT_STATUS_COLOR: Record<AccountSeatSlotStatus, string | undefined> = {
  empty: undefined,
  invited: 'processing',
  member: 'success',
  unknown: 'warning'
};

export function AccountStatusTag({ status }: { status?: 'active' | 'invalid' | 'unknown' }) {
  if (status === 'active') return <Tag color="success">正常</Tag>;
  if (status === 'invalid') return <Tag color="error">失效</Tag>;
  return <Tag>待同步</Tag>;
}

export function BannedStatusTag({
  isBanned,
  label = '已封号'
}: {
  isBanned?: boolean;
  label?: string;
}) {
  return isBanned ? <Tag color="error">{label}</Tag> : null;
}

export function SeatTag({ seat }: { seat?: SeatType }) {
  if (!seat) return null;
  return <Tag color={seat === 'default' ? 'blue' : 'purple'}>{seatLabel(seat)}</Tag>;
}

export function MemberRoleTag({ role }: { role?: MemberRole }) {
  if (!role) return <Tag>待分配</Tag>;
  return <Tag color={MEMBER_ROLE_TAG_COLOR[role]}>{roleLabel(role)}</Tag>;
}

export function SeatSlotStatusTag({
  status,
  memberLabel = SEAT_SLOT_STATUS_LABEL.member
}: {
  status: AccountSeatSlotStatus;
  memberLabel?: string;
}) {
  const label = status === 'member' ? memberLabel : SEAT_SLOT_STATUS_LABEL[status];
  return <Tag color={SEAT_SLOT_STATUS_COLOR[status]}>{label}</Tag>;
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
