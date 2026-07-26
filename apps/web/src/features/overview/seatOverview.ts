import {
  MAX_CHATGPT_SEATS,
  type AccountOverviewView,
  type AccountSeatSlotStatus,
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
  parentIsBanned?: boolean;
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

export function buildSeatOverviewItems(accounts: AccountOverviewView[]): SeatOverviewItem[] {
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

function buildAccountSeatOverviewItems(account: AccountOverviewView): SeatOverviewItem[] {
  const relations = accountRelations(account);
  const relationByEmail = relationMapByEmail(relations);
  const slottedEmails = new Set<string>();
  const items: SeatOverviewItem[] = [];

  for (const slot of account.seatSlots ?? []) {
    const normalizedEmail = normalizeEmail(slot.email);
    if (normalizedEmail) slottedEmails.add(normalizedEmail);
    const relation = normalizedEmail ? relationByEmail.get(normalizedEmail) : undefined;
    items.push({
      ...accountItemBase(account),
      id: `${account.id}:slot:${slot.seatKey}`,
      source: 'seat-slot',
      status: relation?.status ?? slot.status ?? (slot.email ? 'unknown' : 'empty'),
      seat: relation?.seat ?? slot.seat,
      role: relation?.role,
      email: slot.email,
      remark: slot.remark,
      expiresOn: slot.expiresOn,
      expiresOnSource: 'slot',
      price: slot.price,
      seatKey: slot.seatKey
    });
  }

  for (const relation of relations) {
    const normalizedEmail = normalizeEmail(relation.email);
    if (slottedEmails.has(normalizedEmail)) continue;
    slottedEmails.add(normalizedEmail);
    items.push({
      ...accountItemBase(account),
      id: `${account.id}:${relation.source}:${relation.id}`,
      source: relation.source,
      status: relation.status,
      seat: relation.seat,
      role: relation.role,
      email: relation.email,
      ...accountRenewalExpiry(account)
    });
  }

  if (account.hasTeamSubscription) {
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
  }

  return account.isBanned ? items.filter((item) => item.status !== 'empty') : items;
}

function accountRelations(account: AccountOverviewView): Relation[] {
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

function accountItemBase(account: AccountOverviewView): Pick<
  SeatOverviewItem,
  'accountRecordId' | 'workspaceAccountId' | 'teamName' | 'parentEmail' | 'parentIsBanned'
> {
  return {
    accountRecordId: account.id,
    workspaceAccountId: account.accountId,
    teamName: account.workspaceName?.trim() || account.remark?.trim() || account.email || account.accountId,
    parentEmail: account.email,
    parentIsBanned: account.isBanned === true
  };
}

function accountRenewalExpiry(account: AccountOverviewView): Pick<SeatOverviewItem, 'expiresOn' | 'expiresOnSource'> {
  return account.nextRenewalOn
    ? { expiresOn: account.nextRenewalOn, expiresOnSource: 'team-renewal' }
    : {};
}

function compareSeatOverviewItems(a: SeatOverviewItem, b: SeatOverviewItem): number {
  return (
    Number(Boolean(a.parentIsBanned)) - Number(Boolean(b.parentIsBanned)) ||
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
