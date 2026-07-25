import { compareRecordSortName } from '../../components/recordSort.js';

type SubaccountListRecord = { id: string; email: string; remark?: string; isBanned?: boolean };

export function sortSubaccountsForList<T extends SubaccountListRecord>(subaccounts: readonly T[]): T[] {
  return [...subaccounts].sort(compareRecordSortName);
}

export function resolveSubaccountDeleteTarget<T extends SubaccountListRecord>(
  subaccounts: readonly T[],
  selected: T | null,
  targetId: string
): T | null {
  const target = targetId.trim();
  if (!target) return selected;
  return subaccounts.find((subaccount) => subaccount.id === target) ?? null;
}

export function subaccountAfterRemoval<T extends SubaccountListRecord>(
  subaccounts: readonly T[],
  removedId: string
): T | null {
  return subaccounts.find((subaccount) => subaccount.id !== removedId) ?? null;
}
