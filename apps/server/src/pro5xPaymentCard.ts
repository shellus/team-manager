import type {
  AccountManagerOperationView,
  Pro5xPaymentStatisticsView
} from '@team-manager/shared';

export function normalizePro5xCardLast4(value: unknown): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return /^\d{4}$/.test(normalized) ? normalized : undefined;
}

export function pro5xOperationCardLast4(
  operation?: AccountManagerOperationView
): string | undefined {
  return normalizePro5xCardLast4(operation?.requestSummary?.cardLast4);
}

export function successfulPro5xCardLast4ByAccount(
  statistics: Pro5xPaymentStatisticsView
): Map<string, string> {
  const result = new Map<string, string>();
  const attempts = [...statistics.recentAttempts].sort((left, right) => (
    (right.completedAt ?? right.startedAt) - (left.completedAt ?? left.startedAt)
    || right.number - left.number
  ));
  for (const attempt of attempts) {
    if (attempt.decision !== 'succeeded') continue;
    const email = attempt.accountId.trim().toLowerCase();
    const last4 = normalizePro5xCardLast4(attempt.cardLast4);
    if (email && last4 && !result.has(email)) result.set(email, last4);
  }
  return result;
}
