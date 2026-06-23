import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { buildAntdTheme, semanticTokensForMode, type ThemeMode } from './tokens.js';

const THEME_STORAGE_KEY = 'teammgr_theme';

interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readInitialMode(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  return window.localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light';
}

export function TeamManagerThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => readInitialMode());
  const themeConfig = useMemo(() => buildAntdTheme(mode), [mode]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      setMode(nextMode) {
        setModeState(nextMode);
      },
      toggleMode() {
        setModeState((current) => (current === 'dark' ? 'light' : 'dark'));
      }
    }),
    [mode]
  );

  useEffect(() => {
    const tokens = semanticTokensForMode(mode);
    const root = document.documentElement;
    root.dataset.theme = mode;
    root.style.setProperty('--color-bg-app', tokens.colorBgApp);
    root.style.setProperty('--color-bg-shell', tokens.colorBgShell);
    root.style.setProperty('--color-surface', tokens.colorSurface);
    root.style.setProperty('--color-surface-elevated', tokens.colorSurfaceElevated);
    root.style.setProperty('--color-border-subtle', tokens.colorBorderSubtle);
    root.style.setProperty('--color-text', tokens.colorText);
    root.style.setProperty('--color-text-secondary', tokens.colorTextSecondary);
    root.style.setProperty('--color-primary', tokens.colorPrimary);
    root.style.setProperty('--color-danger', tokens.colorDanger);
    root.style.setProperty('--color-warning', tokens.colorWarning);
    root.style.setProperty('--color-success', tokens.colorSuccess);
    root.style.setProperty('--color-info', tokens.colorInfo);
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  }, [mode]);

  return (
    <ThemeContext.Provider value={value}>
      <ConfigProvider locale={zhCN} theme={themeConfig}>
        <AntdApp>{children}</AntdApp>
      </ConfigProvider>
    </ThemeContext.Provider>
  );
}

export function useThemeMode() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useThemeMode must be used inside TeamManagerThemeProvider');
  return value;
}
