import type {
  AccountSeatSlot,
  AccountSeatSlotStatus,
  AccountView,
  Member,
  MemberRole,
  PendingInvite,
  SeatType
} from '@team-manager/shared';

export interface ParentMemberRow {
  key: string;
  email?: string;
  member?: Member;
  invite?: PendingInvite;
  slot?: AccountSeatSlot;
  relationStatus: AccountSeatSlotStatus;
  role?: MemberRole;
  seat: SeatType;
}

export function buildParentMemberRows(account: AccountView): ParentMemberRow[] {
  const rows = new Map<string, Omit<ParentMemberRow, 'relationStatus' | 'role' | 'seat'>>();

  for (const slot of account.seatSlots ?? []) {
    const email = normalizeEmail(slot.email);
    const key = email || `slot:${slot.seatKey}`;
    rows.set(key, { key, ...(email ? { email } : {}), slot });
  }

  for (const invite of account.pendingInvitesCache ?? []) {
    const email = normalizeEmail(invite.email);
    const current = rows.get(email) ?? { key: email, email };
    rows.set(email, { ...current, invite });
  }

  for (const member of account.membersCache ?? []) {
    const email = normalizeEmail(member.email);
    const current = rows.get(email) ?? { key: email, email };
    rows.set(email, { ...current, member });
  }

  return [...rows.values()]
    .map((row): ParentMemberRow => ({
      ...row,
      relationStatus: row.member
        ? 'member'
        : row.invite
          ? 'invited'
          : row.slot?.status ?? (row.email ? 'unknown' : 'empty'),
      role: row.member?.role ?? row.invite?.role,
      seat: row.member?.seat ?? row.invite?.seat ?? row.slot?.seat ?? 'default'
    }))
    .sort(compareParentMemberRows);
}

function compareParentMemberRows(left: ParentMemberRow, right: ParentMemberRow): number {
  return rowRank(left) - rowRank(right)
    || (left.email ?? left.key).localeCompare(right.email ?? right.key);
}

function rowRank(row: ParentMemberRow): number {
  if (row.member?.role === 'account-owner') return 0;
  if (row.member) return 1;
  if (row.invite) return 2;
  if (row.relationStatus === 'unknown') return 3;
  return 4;
}

function normalizeEmail(email: string | undefined): string {
  return email?.trim().toLowerCase() ?? '';
}
