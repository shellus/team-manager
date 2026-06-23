import { theme, type ThemeConfig } from 'antd';

export type ThemeMode = 'light' | 'dark';

export interface SemanticTokens {
  colorBgApp: string;
  colorBgShell: string;
  colorSurface: string;
  colorSurfaceElevated: string;
  colorBorderSubtle: string;
  colorText: string;
  colorTextSecondary: string;
  colorPrimary: string;
  colorDanger: string;
  colorWarning: string;
  colorSuccess: string;
  colorInfo: string;
}

export const lightSemanticTokens: SemanticTokens = {
  colorBgApp: '#f5f7fb',
  colorBgShell: '#ffffff',
  colorSurface: '#ffffff',
  colorSurfaceElevated: '#ffffff',
  colorBorderSubtle: '#d8dee8',
  colorText: '#172033',
  colorTextSecondary: '#5c687a',
  colorPrimary: '#2764e7',
  colorDanger: '#c93535',
  colorWarning: '#a86200',
  colorSuccess: '#197a55',
  colorInfo: '#0b7285'
};

export const darkSemanticTokens: SemanticTokens = {
  colorBgApp: '#0f141b',
  colorBgShell: '#151b23',
  colorSurface: '#18212b',
  colorSurfaceElevated: '#202a36',
  colorBorderSubtle: '#334155',
  colorText: '#edf2f7',
  colorTextSecondary: '#a8b3c2',
  colorPrimary: '#6f9eff',
  colorDanger: '#ff7373',
  colorWarning: '#f5b04c',
  colorSuccess: '#67d7a5',
  colorInfo: '#5ec9dd'
};

export function semanticTokensForMode(mode: ThemeMode): SemanticTokens {
  return mode === 'dark' ? darkSemanticTokens : lightSemanticTokens;
}

export function buildAntdTheme(mode: ThemeMode): ThemeConfig {
  const tokens = semanticTokensForMode(mode);
  return {
    algorithm: mode === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      colorPrimary: tokens.colorPrimary,
      colorError: tokens.colorDanger,
      colorWarning: tokens.colorWarning,
      colorSuccess: tokens.colorSuccess,
      colorInfo: tokens.colorInfo,
      colorBgLayout: tokens.colorBgApp,
      colorBgContainer: tokens.colorSurface,
      colorBgElevated: tokens.colorSurfaceElevated,
      colorBorder: tokens.colorBorderSubtle,
      colorText: tokens.colorText,
      colorTextSecondary: tokens.colorTextSecondary,
      borderRadius: 8,
      controlHeight: 36,
      fontFamily:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", "Microsoft YaHei", Arial, sans-serif'
    },
    components: {
      Button: {
        borderRadius: 6,
        controlHeight: 34
      },
      Card: {
        borderRadiusLG: 8
      },
      Modal: {
        borderRadiusLG: 8
      },
      Table: {
        cellPaddingBlock: 10,
        cellPaddingInline: 12
      }
    }
  };
}
