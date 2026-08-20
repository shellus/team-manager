export function fixedSeatCapacity(value: unknown): number | undefined {
  return integer(value, 1);
}

export function subscriptionSeatsInUse(value: unknown): number | undefined {
  return integer(value, 0);
}

function integer(value: unknown, minimum: number): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum ? value : undefined;
}
