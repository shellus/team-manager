import { describe, expect, test } from 'vitest';
import {
  actionBusyKeys,
  actionTargetByPrefix,
  finishBusyAction,
  isActionBusy,
  startBusyAction
} from './actionBusy.js';

describe('action busy state', () => {
  test('keeps unrelated button loading states independent', () => {
    const first = 'modal-delete-parent';
    const second = 'modal-invite-member';

    const active = startBusyAction(startBusyAction({}, first), second);
    const afterSecondFinished = finishBusyAction(active, second);

    expect(isActionBusy(active, first)).toBe(true);
    expect(isActionBusy(active, second)).toBe(true);
    expect(isActionBusy(afterSecondFinished, first)).toBe(true);
    expect(isActionBusy(afterSecondFinished, second)).toBe(false);
  });

  test('uses a count so duplicate starts do not clear a button too early', () => {
    const active = startBusyAction(startBusyAction({}, 'row-a'), 'row-a');

    expect(isActionBusy(finishBusyAction(active, 'row-a'), 'row-a')).toBe(true);
    expect(isActionBusy(finishBusyAction(finishBusyAction(active, 'row-a'), 'row-a'), 'row-a')).toBe(false);
  });

  test('returns stable keys and prefix targets for progress polling', () => {
    const active = startBusyAction(
      startBusyAction({}, 'codex-pat-workspace-a'),
      'codex-auto-workspace-b'
    );

    expect(actionBusyKeys(active)).toEqual(['codex-pat-workspace-a', 'codex-auto-workspace-b']);
    expect(actionTargetByPrefix(active, 'codex-auto-')).toBe('workspace-b');
    expect(actionTargetByPrefix(active, 'missing-')).toBe('');
  });
});
