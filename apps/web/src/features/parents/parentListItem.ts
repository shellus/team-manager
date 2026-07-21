export function parentListIdentity(account: { remark?: string; email: string }): string {
  const email = account.email.trim();
  const remark = account.remark?.trim();
  if (!remark || remark.toLowerCase() === email.toLowerCase()) return email;
  return `${remark} · ${email}`;
}

export function parentChatGptSeatUsageCount(account: {
  chatGptSeatUsageCount?: number;
  membersCache?: unknown[];
  pendingInvitesCache?: unknown[];
}): number | undefined {
  if (typeof account.chatGptSeatUsageCount === 'number') return account.chatGptSeatUsageCount;
  if (!account.membersCache && !account.pendingInvitesCache) return undefined;
  const memberSeats = account.membersCache?.filter((member) => seatOf(member) === 'default').length ?? 0;
  const invitedSeats = account.pendingInvitesCache?.filter((invite) => seatOf(invite) === 'default').length ?? 0;
  return memberSeats + invitedSeats;
}

export function parentMemberAndInviteCount(account: {
  memberAndInviteCount?: number;
  membersCache?: unknown[];
  pendingInvitesCache?: unknown[];
}): number | undefined {
  if (typeof account.memberAndInviteCount === 'number') return account.memberAndInviteCount;
  if (!account.membersCache && !account.pendingInvitesCache) return undefined;
  return (account.membersCache?.length ?? 0) + (account.pendingInvitesCache?.length ?? 0);
}

function seatOf(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const seat = (value as { seat?: unknown }).seat;
  return typeof seat === 'string' ? seat : undefined;
}

export function parentSeatUsageClass(seatCount: number | undefined, includedSeatCount: number): string | undefined {
  if (seatCount === undefined) return undefined;
  if (seatCount > includedSeatCount) return 'text-warning';
  if (seatCount === includedSeatCount) return 'text-success';
  return undefined;
}
