import { useCallback, useMemo, useState } from 'react';
import {
  actionBusyKeys,
  finishBusyAction,
  isActionBusy,
  startBusyAction,
  type ActionBusyState
} from './actionBusy.js';

export function useActionBusy() {
  const [busyState, setBusyState] = useState<ActionBusyState>({});
  const busyKeys = useMemo(() => actionBusyKeys(busyState), [busyState]);

  const start = useCallback((key: string) => {
    setBusyState((current) => startBusyAction(current, key));
  }, []);

  const finish = useCallback((key: string) => {
    setBusyState((current) => finishBusyAction(current, key));
  }, []);

  const isBusy = useCallback((key: string) => isActionBusy(busyState, key), [busyState]);

  const run = useCallback(
    async <T,>(key: string, fn: () => Promise<T>): Promise<T> => {
      start(key);
      try {
        return await fn();
      } finally {
        finish(key);
      }
    },
    [finish, start]
  );

  return {
    busyState,
    busyKeys,
    start,
    finish,
    isBusy,
    run
  };
}
