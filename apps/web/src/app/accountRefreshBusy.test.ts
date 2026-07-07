import { describe, expect, test } from 'vitest';
import type { AccountView } from '@team-manager/shared';
import { finishBusyAction, startBusyAction } from '../components/actionBusy.js';
import { accountRefreshActionKey, syncingAccountIdsFromBusy } from './accountRefreshBusy.js';

describe('account refresh busy state', () => {
  test('keeps the same account refreshing while duplicate refreshes are still running', () => {
    const accounts = [{ id: 'account-a' }, { id: 'account-b' }] as AccountView[];
    const key = accountRefreshActionKey('account-a');
    const active = startBusyAction(startBusyAction({}, key), key);
    const afterOneFinished = finishBusyAction(active, key);

    expect(syncingAccountIdsFromBusy(accounts, afterOneFinished)).toEqual(new Set(['account-a']));
    expect(syncingAccountIdsFromBusy(accounts, finishBusyAction(afterOneFinished, key))).toEqual(new Set());
  });
});
