export const LIMITED_RETRY_DELAYS_MS = [60_000, 5 * 60_000] as const;
export const LIMITED_MAX_ATTEMPTS = LIMITED_RETRY_DELAYS_MS.length + 1;

export function limitedRetryDelay(attemptCount: number): number | undefined {
  return LIMITED_RETRY_DELAYS_MS[attemptCount - 1];
}
