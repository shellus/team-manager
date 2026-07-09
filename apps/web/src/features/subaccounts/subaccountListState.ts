import type { SubaccountView } from '@team-manager/shared';
import { compareRecordSortName } from '../../components/recordSort.js';

export function sortSubaccountsForList(subaccounts: readonly SubaccountView[]): SubaccountView[] {
  return [...subaccounts].sort(compareRecordSortName);
}

export function resolveSubaccountDeleteTarget(
  subaccounts: readonly SubaccountView[],
  selected: SubaccountView | null,
  targetId: string
): SubaccountView | null {
  const target = targetId.trim();
  if (!target) return selected;
  return subaccounts.find((subaccount) => subaccount.id === target) ?? null;
}

export function subaccountAfterRemoval(
  subaccounts: readonly SubaccountView[],
  removedId: string
): SubaccountView | null {
  return subaccounts.find((subaccount) => subaccount.id !== removedId) ?? null;
}
