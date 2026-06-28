export function buildSeatManagementUrl(seatKey: string, origin = globalThis.location?.origin ?? ''): string {
  const path = `/seat/${encodeURIComponent(seatKey)}`;
  return origin ? new URL(path, origin).toString() : path;
}
