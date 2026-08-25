import type { SeatSlotExpirationStatus } from '@team-manager/shared';

export const SEAT_EXPIRATION_TIME_ZONE = 'Asia/Shanghai';

export function seatExpirationBusinessDate(now: Date): string {
  return calendarDateInTimeZone(now, SEAT_EXPIRATION_TIME_ZONE);
}

export function seatSlotExpirationStatus(
  expiresOn: string | Date | null | undefined,
  now = new Date()
): SeatSlotExpirationStatus {
  if (!expiresOn) return 'not_set';
  const date = expiresOn instanceof Date ? expiresOn.toISOString().slice(0, 10) : String(expiresOn).slice(0, 10);
  const today = seatExpirationBusinessDate(now);
  if (date < today) return 'expired';
  if (date === today) return 'expires_today';
  return 'active';
}

export function calendarDateInTimeZone(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  return `${part(parts, 'year')}-${part(parts, 'month')}-${part(parts, 'day')}`;
}

export function addCalendarDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  const value = parts.find((item) => item.type === type)?.value;
  if (!value) throw new Error(`日期缺少 ${type}`);
  return value;
}
