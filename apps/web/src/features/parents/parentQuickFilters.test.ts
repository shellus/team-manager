import { accountSummaryFromView, type AccountView } from '@team-manager/shared';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  PARENT_QUICK_FILTER_PREFERENCE_KEY,
  normalizeParentQuickFilters,
  parentMatchesQuickFilters,
  parseParentQuickFilters,
  readParentQuickFilterPreference,
  rememberParentQuickFilterPreference,
  serializeParentQuickFilters
} from './parentQuickFilters.js';

const baseView: AccountView = {
  id: 'parent-1',
  managedAccountEmail: 'parent@example.com',
  groupName: '默认分组',
  limitType: 'monthly',
  accountId: 'workspace-1',
  email: 'parent@example.com',
  status: 'active',
  hasTeamSubscription: true,
  canManageWorkspace: true
};
const parent = accountSummaryFromView(baseView);

describe('parentQuickFilters', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('normalizes URL filters into a stable supported order', () => {
    expect(parseParentQuickFilters('team,bad,gam,team,codex')).toEqual(['gam', 'codex', 'team']);
    expect(normalizeParentQuickFilters(['monthly', 'weekly'])).toEqual(['weekly', 'monthly']);
    expect(parseParentQuickFilters('codex,no-codex,team,no-team')).toEqual(['no-codex', 'no-team']);
    expect(serializeParentQuickFilters(['team', 'gam', 'codex'])).toBe('gam,codex,team');
  });

  test('filters GAM and non-GAM as mutually exclusive source states', () => {
    const nonGam = { ...parent, managedAccountEmail: undefined };

    expect(parentMatchesQuickFilters(parent, undefined, new Set(), ['gam'])).toBe(true);
    expect(parentMatchesQuickFilters(nonGam, undefined, new Set(), ['non-gam'])).toBe(true);
    expect(parentMatchesQuickFilters(nonGam, undefined, new Set(), ['gam'])).toBe(false);
  });

  test('combines 0.52 and two-seat Team capabilities', () => {
    const status = {
      configured: true,
      reachable: true,
      managed: true,
      hasCodexSpace: true,
      hasTeamSubscription: true
    };

    expect(parentMatchesQuickFilters(parent, status, new Set(), ['codex', 'team'])).toBe(true);
    expect(parentMatchesQuickFilters(parent, { ...status, hasCodexSpace: false }, new Set(), ['codex', 'team'])).toBe(false);
    expect(parentMatchesQuickFilters(
      { ...parent, hasTeamSubscription: false },
      { ...status, hasTeamSubscription: false },
      new Set(),
      ['codex', 'team']
    )).toBe(false);
    expect(parentMatchesQuickFilters(parent, status, new Set(), ['no-codex'])).toBe(false);
    expect(parentMatchesQuickFilters(
      { ...parent, hasTeamSubscription: false },
      { ...status, hasCodexSpace: false, hasTeamSubscription: false },
      new Set(),
      ['no-codex', 'no-team']
    )).toBe(true);
  });

  test('matches selected limit types as alternatives and only for two-seat Team parents', () => {
    expect(parentMatchesQuickFilters(parent, undefined, new Set(), ['weekly', 'monthly'])).toBe(true);
    expect(parentMatchesQuickFilters({ ...parent, limitType: 'unknown' }, undefined, new Set(), ['limit-unknown'])).toBe(true);
    expect(parentMatchesQuickFilters(
      { ...parent, limitType: 'unknown', hasTeamSubscription: false },
      undefined,
      new Set(),
      ['limit-unknown']
    )).toBe(false);
  });

  test('combines banned and order-maintenance flags', () => {
    const maintained = new Set([parent.id]);

    expect(parentMatchesQuickFilters({ ...parent, isBanned: true }, undefined, maintained, ['banned', 'maintained'])).toBe(true);
    expect(parentMatchesQuickFilters(parent, undefined, maintained, ['banned', 'maintained'])).toBe(false);
    expect(parentMatchesQuickFilters(parent, undefined, new Set(), ['not-banned', 'not-maintained'])).toBe(true);
  });

  test('remembers the normalized filters in local storage', () => {
    const values = new Map<string, string>();
    const localStorage: Storage = {
      get length() { return values.size; },
      clear: () => values.clear(),
      getItem: (key) => values.get(key) ?? null,
      key: (index) => [...values.keys()][index] ?? null,
      removeItem: (key) => { values.delete(key); },
      setItem: (key, value) => { values.set(key, value); }
    };
    vi.stubGlobal('window', { localStorage });

    rememberParentQuickFilterPreference(['team', 'codex']);

    expect(values.get(PARENT_QUICK_FILTER_PREFERENCE_KEY)).toBe('codex,team');
    expect(readParentQuickFilterPreference()).toEqual(['codex', 'team']);
  });
});
