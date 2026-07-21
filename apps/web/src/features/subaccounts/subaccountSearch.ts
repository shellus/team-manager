import type { SubaccountRegistrationJobView, SubaccountSummaryView, SubaccountView } from '@team-manager/shared';
import { matchesKeywordQuery } from '../../components/keywordSearch.js';

export function subaccountMatchesQuery(subaccount: SubaccountSummaryView | SubaccountView, query: string): boolean {
  if ('searchText' in subaccount) return matchesKeywordQuery([subaccount.searchText], query);
  return matchesKeywordQuery([
    subaccount.email,
    subaccount.remark,
    subaccount.groupName,
    subaccount.chatgptAccountId,
    subaccount.remoteUsername,
    subaccount.remoteDisplayName,
    subaccount.managedAccountEmail,
    subaccount.status,
    ...subaccount.teamLinks.flatMap((link) => [link.workspaceId, link.workspaceName, link.planType, link.role])
  ], query);
}

export function registrationJobMatchesQuery(job: SubaccountRegistrationJobView, query: string): boolean {
  return matchesKeywordQuery([
    job.email,
    job.status,
    job.phase,
    job.message,
    job.error
  ], query);
}
