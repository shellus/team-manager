import { describe, expect, test } from 'vitest';
import { shouldResetPageError } from './PageErrorBoundary.js';

describe('PageErrorBoundary route reset', () => {
  test('does not reset or remount healthy page state when the selected route changes', () => {
    expect(shouldResetPageError('/parents/account-1', '/parents/account-2', undefined)).toBe(false);
  });

  test('clears a captured page error after navigating to another route', () => {
    expect(shouldResetPageError(
      '/parents/account-1',
      '/parents/account-2',
      new Error('detail render failed')
    )).toBe(true);
  });

  test('keeps the current error while the route is unchanged', () => {
    expect(shouldResetPageError(
      '/parents/account-1',
      '/parents/account-1',
      new Error('detail render failed')
    )).toBe(false);
  });
});
