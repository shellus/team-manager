import {
  DEFAULT_TASK_FORM_PREFERENCES,
  type TaskFormPreferences
} from '@team-manager/shared';
import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../api.js';

function defaultPreferences(): TaskFormPreferences {
  return {
    parentRegistration: { ...DEFAULT_TASK_FORM_PREFERENCES.parentRegistration },
    subaccountRegistration: { ...DEFAULT_TASK_FORM_PREFERENCES.subaccountRegistration },
    pro5x: { ...DEFAULT_TASK_FORM_PREFERENCES.pro5x }
  };
}

export function useTaskFormPreferences() {
  const [preferences, setPreferences] = useState<TaskFormPreferences>(defaultPreferences);

  useEffect(() => {
    let cancelled = false;
    void apiClient.getTaskFormPreferences()
      .then((next) => {
        if (!cancelled) setPreferences(next);
      })
      .catch(() => {
        // 偏好读取失败时继续使用安全默认值，不阻塞任务入口。
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rememberPreference = useCallback(<K extends keyof TaskFormPreferences,>(
    key: K,
    value: TaskFormPreferences[K]
  ) => {
    setPreferences((current) => ({ ...current, [key]: value }));
  }, []);

  return { preferences, rememberPreference };
}
