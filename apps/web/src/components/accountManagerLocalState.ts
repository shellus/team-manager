export function hasManagedAccountReference(email?: string): boolean {
  return Boolean(email?.trim());
}

export function hasPro5xFromLocalState(
  localHasPro5x?: boolean,
  liveHasPro5x?: boolean
): boolean {
  return localHasPro5x === true || liveHasPro5x === true;
}

export function openedPro5xButtonLabel(cardLast4?: string): string {
  const normalized = cardLast4?.trim() ?? '';
  return /^\d{4}$/.test(normalized)
    ? `已开 Pro 5x · ${normalized}`
    : '已开 Pro 5x';
}
