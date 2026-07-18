import type { SubaccountRegistrationJobView, SubaccountView } from '@team-manager/shared';
import { matchesKeywordQuery } from '../../components/keywordSearch.js';

export function subaccountMatchesQuery(subaccount: SubaccountView, query: string): boolean {
  return matchesKeywordQuery([
    subaccount.email,
    subaccount.remark,
    subaccount.groupName,
    subaccount.chatgptAccountId,
    subaccount.remoteUsername,
    subaccount.remoteDisplayName,
    subaccount.cloakProfileName,
    subaccount.cloakProfileId,
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
    job.error,
    job.cloakProfileName,
    job.cloakProfileId
  ], query);
}
