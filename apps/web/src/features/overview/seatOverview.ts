import type {
  AccountSeatSlotStatus,
  SeatOverviewItem,
  SeatType
} from '@team-manager/shared';

export {
  buildSeatOverviewItems,
  filterSeatOverviewItems
} from '@team-manager/shared';
export type {
  SeatOverviewExpirySource,
  SeatOverviewFilterOptions,
  SeatOverviewItem,
  SeatOverviewSource
} from '@team-manager/shared';

export type SeatOverviewBadgeTarget =
  | { kind: 'seat'; seat: SeatType }
  | { kind: 'status'; status: AccountSeatSlotStatus };

export interface SeatOverviewCardIdentity {
  primary: string;
  secondary: string;
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
