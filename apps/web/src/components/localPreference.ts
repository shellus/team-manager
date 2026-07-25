export function readLocalPreference(storageKey: string): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage.getItem(storageKey) ?? undefined;
  } catch {
    return undefined;
  }
}

export function rememberLocalPreference(storageKey: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey, value);
  } catch {
    // 浏览器禁用本地存储时，URL 中的状态仍然可用。
  }
}
