import { compareRecordSortName } from '../../components/recordSort.js';
import type {
  AccountManagerProfileView,
  SubaccountRegistrationJobView,
  SubaccountSummaryView
} from '@team-manager/shared';
import { compareRunningProfileFirst } from '../../components/AccountProfileListStatus.js';

type SubaccountListRecord = { id: string; email: string; remark?: string; isBanned?: boolean };

export function sortSubaccountsForList<T extends SubaccountListRecord>(
  subaccounts: readonly T[],
  profiles: Record<string, AccountManagerProfileView> = {}
): T[] {
  return [...subaccounts].sort((left, right) => compareRunningProfileFirst(
    left,
    right,
    profiles,
    compareRecordSortName
  ));
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

export function visibleSubaccountRegistrationJobs(
  jobs: SubaccountRegistrationJobView[],
  subaccounts: SubaccountSummaryView[]
): SubaccountRegistrationJobView[] {
  const subaccountById = new Map(subaccounts.map((subaccount) => [subaccount.id, subaccount]));
  return jobs.filter((job) => {
    if (job.status === 'succeeded') return false;
    if (job.subaccountId && !subaccountById.has(job.subaccountId)) return false;
    if (job.status === 'failed' || job.status === 'interrupted' || job.status === 'waiting_manual') {
      const linkedSubaccount = job.subaccountId ? subaccountById.get(job.subaccountId) : undefined;
      if (linkedSubaccount && linkedSubaccount.status !== 'error' && linkedSubaccount.status !== 'verification_required') {
        return false;
      }
      return true;
    }
    return !job.subaccountId || !subaccountById.has(job.subaccountId);
  });
}
