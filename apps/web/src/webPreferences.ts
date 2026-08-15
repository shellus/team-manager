import { useEffect, useState } from "react";
import type { FormInstance } from "antd";
import { unifiedApi } from "./unifiedApi.js";

export interface WebPreferences {
  rememberFormValues: boolean;
  autoRefreshOperations: boolean;
}

const DEFAULT_PREFERENCES: WebPreferences = {
  rememberFormValues: false,
  autoRefreshOperations: false,
};

let cached: WebPreferences | undefined;
let loading: Promise<WebPreferences> | undefined;
const listeners = new Set<(preferences: WebPreferences) => void>();

export function normalizeWebPreferences(
  value?: Record<string, unknown> | WebPreferences,
): WebPreferences {
  return {
    rememberFormValues: value?.rememberFormValues === true,
    autoRefreshOperations: value?.autoRefreshOperations === true,
  };
}

export function loadWebPreferences(): Promise<WebPreferences> {
  if (cached) return Promise.resolve(cached);
  if (loading) return loading;
  loading = unifiedApi
    .systemSettings()
    .then((settings) =>
      setWebPreferences(
        normalizeWebPreferences(
          settings.find((row) => row.key === "web.preferences")?.value,
        ),
      ),
    )
    .catch(() => setWebPreferences(DEFAULT_PREFERENCES))
    .finally(() => {
      loading = undefined;
    });
  return loading;
}

export function setWebPreferences(
  value: Record<string, unknown> | WebPreferences,
): WebPreferences {
  cached = normalizeWebPreferences(value);
  listeners.forEach((listener) => listener(cached!));
  return cached;
}

export function useWebPreferences(): WebPreferences {
  const [preferences, setPreferences] = useState(cached ?? DEFAULT_PREFERENCES);
  useEffect(() => {
    listeners.add(setPreferences);
    void loadWebPreferences().then(setPreferences);
    return () => {
      listeners.delete(setPreferences);
    };
  }, []);
  return preferences;
}

export function rememberedValues<T extends object>(
  value: T,
  keys: readonly (keyof T)[],
): Partial<T> {
  return Object.fromEntries(
    keys
      .filter((key) => value[key] !== undefined)
      .map((key) => [String(key), value[key]]),
  ) as Partial<T>;
}

export function useRememberedForm<T extends object>(
  form: FormInstance<T>,
  storageKey: string,
  keys: readonly (keyof T)[],
) {
  const preferences = useWebPreferences();
  useEffect(() => {
    if (!preferences.rememberFormValues) return;
    try {
      const value = JSON.parse(
        localStorage.getItem(`team-manager:form:${storageKey}`) ?? "null",
      );
      if (value && typeof value === "object" && !Array.isArray(value))
        form.setFieldsValue(value);
    } catch {
      localStorage.removeItem(`team-manager:form:${storageKey}`);
    }
  }, [form, preferences.rememberFormValues, storageKey]);

  return (value: T) => {
    if (!preferences.rememberFormValues) {
      localStorage.removeItem(`team-manager:form:${storageKey}`);
      return;
    }
    localStorage.setItem(
      `team-manager:form:${storageKey}`,
      JSON.stringify(rememberedValues(value, keys)),
    );
  };
}
