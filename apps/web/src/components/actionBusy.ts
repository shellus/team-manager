export type ActionBusyState = Readonly<Record<string, number>>;

function cleanActionKey(key: string): string {
  return key.trim();
}

export function startBusyAction(current: ActionBusyState, key: string): ActionBusyState {
  const target = cleanActionKey(key);
  if (!target) return current;
  return {
    ...current,
    [target]: (current[target] ?? 0) + 1
  };
}

export function finishBusyAction(current: ActionBusyState, key: string): ActionBusyState {
  const target = cleanActionKey(key);
  if (!target || !current[target]) return current;
  const nextCount = current[target]! - 1;
  if (nextCount > 0) return { ...current, [target]: nextCount };
  const { [target]: _removed, ...next } = current;
  return next;
}

export function isActionBusy(current: ActionBusyState, key: string): boolean {
  const target = cleanActionKey(key);
  return Boolean(target && current[target]);
}

export function actionBusyKeys(current: ActionBusyState): string[] {
  return Object.keys(current).filter((key) => current[key]! > 0);
}

export function actionTargetByPrefix(current: ActionBusyState, prefix: string): string {
  const targetPrefix = cleanActionKey(prefix);
  if (!targetPrefix) return '';
  const key = actionBusyKeys(current).find((item) => item.startsWith(targetPrefix));
  return key ? key.slice(targetPrefix.length) : '';
}

export function actionKey(prefix: string, target?: string): string {
  return `${prefix}-${target?.trim() || 'default'}`;
}
