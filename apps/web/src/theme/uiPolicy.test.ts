/// <reference types="node" />

import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildAntdTheme } from './tokens.js';
import { productPageSizeChanger, productUiPolicy } from './uiPolicy.js';

const popupPolicySource = readFileSync(new URL('./popupPolicy.css', import.meta.url), 'utf8');
const applicationStylesSource = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

const componentSources = import.meta.glob('../**/*.tsx', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>;

describe('product UI policy', () => {
  test('globally disables component motion in both themes', () => {
    expect(buildAntdTheme('light').token?.motion).toBe(false);
    expect(buildAntdTheme('dark').token?.motion).toBe(false);
  });

  test('shares one page-size selector policy with ConfigProvider', () => {
    expect(productUiPolicy.virtual).toBe(false);
    expect(productUiPolicy.popupOverflow).toBe('viewport');
    expect(productUiPolicy.pagination.showSizeChanger).toBe(productPageSizeChanger);
  });

  test('does not bypass product overlay primitives or page-size policy', () => {
    for (const [path, source] of Object.entries(componentSources)) {
      if (!path.endsWith('/ProductOverlays.tsx')) {
        expect(source, path).not.toMatch(/<(?:Modal|Drawer)\b/);
        expect(source, path).not.toMatch(/\bModal\.(?:confirm|info|success|error|warning)\s*\(/);
        expect(source, path).not.toMatch(/\bApp\.useApp\s*\(/);
        expect(source, path).not.toMatch(
          /import\s*\{[^;]*\b(?:Modal|Drawer|message|notification)\b[^;]*\}\s*from\s*['"]antd['"]/,
        );
      }
      if (!path.endsWith('/ProductPagination.tsx')) {
        expect(source, path).not.toMatch(/<Pagination\b/);
        expect(source, path).not.toMatch(
          /import\s*\{[^;]*\bPagination\b[^;]*\}\s*from\s*['"]antd['"]/,
        );
      }
      if (!path.endsWith('/ThemeProvider.tsx')) {
        expect(source, path).not.toMatch(/\bgetPopupContainer\s*=/);
      }
      expect(source, path).not.toMatch(/\b(?:popupMatchSelectWidth|popupOverflow|virtual)\s*=/);
      expect(source, path).not.toMatch(/\bshowSizeChanger\s*=/);
    }
  });

  test('keeps Select positioning fixes in the global popup policy stylesheet', () => {
    expect(popupPolicySource).toContain('opacity: 1 !important');
    expect(popupPolicySource).toContain('transform: none !important');
    expect(popupPolicySource).toContain('transition: none !important');
    expect(popupPolicySource).toContain('animation: none !important');
    expect(applicationStylesSource).not.toContain('ant-select-dropdown');
  });
});
