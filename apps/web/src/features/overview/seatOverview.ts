import {
  MAX_CHATGPT_SEATS,
  type AccountSeatSlotStatus,
  type AccountView,
  type MemberRole,
  type SeatType
} from '@team-manager/shared';

export type SeatOverviewSource = 'seat-slot' | 'member' | 'invite' | 'placeholder';
export type SeatOverviewExpirySource = 'slot' | 'team-renewal';

export interface SeatOverviewFilterOptions {
  showOwners?: boolean;
  showCodexSeats?: boolean;
}

export interface SeatOverviewItem {
  id: string;
  accountRecordId: string;
  workspaceAccountId: string;
  teamName: string;
  parentEmail: string;
  source: SeatOverviewSource;
  status: AccountSeatSlotStatus;
  seat: SeatType;
  role?: MemberRole;
  email?: string;
  remark?: string;
  expiresOn?: string;
  expiresOnSource?: SeatOverviewExpirySource;
  price?: string;
  seatKey?: string;
}

export type SeatOverviewBadgeTarget =
  | { kind: 'seat'; seat: SeatType }
  | { kind: 'status'; status: AccountSeatSlotStatus };

export interface SeatOverviewCardIdentity {
  primary: string;
  secondary: string;
}

interface Relation {
  id: string;
  email: string;
  role: MemberRole;
  seat: SeatType;
  status: AccountSeatSlotStatus;
  source: 'member' | 'invite';
}

export function buildSeatOverviewItems(accounts: AccountView[]): SeatOverviewItem[] {
  return accounts.flatMap(buildAccountSeatOverviewItems).sort(compareSeatOverviewItems);
}

export function filterSeatOverviewItems<T extends SeatOverviewItem>(
  items: readonly T[],
  options: SeatOverviewFilterOptions = {}
): T[] {
  return items.filter((item) => {
    if (!options.showOwners && item.role === 'account-owner') return false;
    if (!options.showCodexSeats && item.seat === 'usage_based') return false;
    return true;
  });
}

export function seatOverviewBadgeTarget(item: SeatOverviewItem): SeatOverviewBadgeTarget {
  return item.status === 'member'
    ? { kind: 'seat', seat: item.seat }
    : { kind: 'status', status: item.status };
}

export function seatOverviewCardIdentity(item: SeatOverviewItem): SeatOverviewCardIdentity {
  return {
    primary: item.email || '空位',
    secondary: item.teamName
  };
}

function buildAccountSeatOverviewItems(account: AccountView): SeatOverviewItem[] {
  const relations = accountRelations(account);
  const relationByEmail = relationMapByEmail(relations);
  const slotEmails = new Set<string>();
  const items: SeatOverviewItem[] = [];

  for (const slot of account.seatSlots ?? []) {
    const normalizedEmail = normalizeEmail(slot.email);
    if (normalizedEmail) slotEmails.add(normalizedEmail);
    const relation = normalizedEmail ? relationByEmail.get(normalizedEmail) : undefined;
    items.push({
      ...accountItemBase(account),
      id: `${account.id}:slot:${slot.seatKey}`,
      source: 'seat-slot',
      status: slot.status ?? relation?.status ?? (slot.email ? 'unknown' : 'empty'),
      seat: 'default',
      role: relation?.role,
      email: slot.email,
      remark: slot.remark,
      expiresOn: slot.expiresOn,
      expiresOnSource: 'slot',
      price: slot.price,
      seatKey: slot.seatKey
    });
  }

  const usedDefaultEmails = new Set(slotEmails);
  for (const relation of relations) {
    if (relation.seat !== 'default') continue;
    const normalizedEmail = normalizeEmail(relation.email);
    if (usedDefaultEmails.has(normalizedEmail)) continue;
    usedDefaultEmails.add(normalizedEmail);
    items.push({
      ...accountItemBase(account),
      id: `${account.id}:${relation.source}:${relation.id}`,
      source: relation.source,
      status: relation.status,
      seat: 'default',
      role: relation.role,
      email: relation.email,
      ...accountRenewalExpiry(account)
    });
  }

  const chatGptPositionCount = items.filter((item) => item.seat === 'default').length;
  for (let index = chatGptPositionCount; index < MAX_CHATGPT_SEATS; index += 1) {
    items.push({
      ...accountItemBase(account),
      id: `${account.id}:empty:${index + 1}`,
      source: 'placeholder',
      status: 'empty',
      seat: 'default',
      ...accountRenewalExpiry(account)
    });
  }

  const usedCodexEmails = new Set<string>();
  for (const relation of relations) {
    if (relation.seat !== 'usage_based') continue;
    const normalizedEmail = normalizeEmail(relation.email);
    if (usedCodexEmails.has(normalizedEmail)) continue;
    usedCodexEmails.add(normalizedEmail);
    items.push({
      ...accountItemBase(account),
      id: `${account.id}:${relation.source}:${relation.id}`,
      source: relation.source,
      status: relation.status,
      seat: 'usage_based',
      role: relation.role,
      email: relation.email,
      ...accountRenewalExpiry(account)
    });
  }

  return items;
}

function accountRelations(account: AccountView): Relation[] {
  return [
    ...(account.membersCache ?? []).map((member): Relation => ({
      id: member.userId,
      email: member.email,
      role: member.role,
      seat: member.seat,
      status: 'member',
      source: 'member'
    })),
    ...(account.pendingInvitesCache ?? []).map((invite): Relation => ({
      id: invite.inviteId,
      email: invite.email,
      role: invite.role,
      seat: invite.seat,
      status: 'invited',
      source: 'invite'
    }))
  ];
}

function relationMapByEmail(relations: Relation[]): Map<string, Relation> {
  const byEmail = new Map<string, Relation>();
  for (const relation of relations) {
    const email = normalizeEmail(relation.email);
    if (email && !byEmail.has(email)) byEmail.set(email, relation);
  }
  return byEmail;
}

function accountItemBase(account: AccountView): Pick<
  SeatOverviewItem,
  'accountRecordId' | 'workspaceAccountId' | 'teamName' | 'parentEmail'
> {
  return {
    accountRecordId: account.id,
    workspaceAccountId: account.accountId,
    teamName: account.workspaceName?.trim() || account.remark?.trim() || account.email || account.accountId,
    parentEmail: account.email
  };
}

function accountRenewalExpiry(account: AccountView): Pick<SeatOverviewItem, 'expiresOn' | 'expiresOnSource'> {
  return account.nextRenewalOn
    ? { expiresOn: account.nextRenewalOn, expiresOnSource: 'team-renewal' }
    : {};
}

function compareSeatOverviewItems(a: SeatOverviewItem, b: SeatOverviewItem): number {
  return (
    dateRank(a.expiresOn) - dateRank(b.expiresOn) ||
    a.teamName.localeCompare(b.teamName, 'zh-CN', { numeric: true, sensitivity: 'base' }) ||
    seatRank(a.seat) - seatRank(b.seat) ||
    sourceRank(a.source) - sourceRank(b.source) ||
    (a.email ?? '').localeCompare(b.email ?? '', 'zh-CN', { numeric: true, sensitivity: 'base' }) ||
    a.id.localeCompare(b.id)
  );
}

function dateRank(value: string | undefined): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
}

function seatRank(seat: SeatType): number {
  return seat === 'default' ? 0 : 1;
}

function sourceRank(source: SeatOverviewSource): number {
  if (source === 'seat-slot') return 0;
  if (source === 'member') return 1;
  if (source === 'invite') return 2;
  return 3;
}

function normalizeEmail(email: string | undefined): string {
  return email?.trim().toLowerCase() ?? '';
}
