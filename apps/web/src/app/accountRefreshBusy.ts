import { actionKey, isActionBusy, type ActionBusyState } from '../components/actionBusy.js';

export function accountRefreshActionKey(accountId: string): string {
  return actionKey('account-refresh', accountId);
}

export function syncingAccountIdsFromBusy<T extends { id: string }>(accounts: T[], busyState: ActionBusyState): Set<string> {
  return new Set(
    accounts
      .filter((account) => isActionBusy(busyState, accountRefreshActionKey(account.id)))
      .map((account) => account.id)
  );
}
