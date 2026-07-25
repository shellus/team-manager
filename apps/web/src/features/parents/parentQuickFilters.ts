import type {
  AccountLimitType,
  AccountSummaryView,
  ParentAccountManagerStatus
} from '@team-manager/shared';
import { readLocalPreference, rememberLocalPreference } from '../../components/localPreference.js';
import { hasParentCodexSpace } from './parentWorkspaceCapability.js';

export const PARENT_QUICK_FILTER_PREFERENCE_KEY = 'team-manager:parents:quick-filters';
export const PARENT_QUICK_FILTER_PARAM = 'tags';

export const PARENT_QUICK_FILTER_GROUPS = [
  {
    label: 'GAM',
    selection: 'single',
    options: [
      { value: 'gam', label: '是' },
      { value: 'non-gam', label: '否' }
    ]
  },
  {
    label: '0.52',
    selection: 'single',
    options: [
      { value: 'codex', label: '是' },
      { value: 'no-codex', label: '否' }
    ]
  },
  {
    label: '双席位',
    selection: 'single',
    options: [
      { value: 'team', label: '是' },
      { value: 'no-team', label: '否' }
    ]
  },
  {
    label: '限额',
    selection: 'multiple',
    options: [
      { value: 'weekly', label: '周限' },
      { value: 'monthly', label: '月限' },
      { value: 'limit-unknown', label: '未知' }
    ]
  },
  {
    label: '封号',
    selection: 'single',
    options: [
      { value: 'banned', label: '是' },
      { value: 'not-banned', label: '否' }
    ]
  },
  {
    label: '订单维护',
    selection: 'single',
    options: [
      { value: 'maintained', label: '是' },
      { value: 'not-maintained', label: '否' }
    ]
  }
] as const;

export type ParentQuickFilter = typeof PARENT_QUICK_FILTER_GROUPS[number]['options'][number]['value'];

const parentQuickFilterOrder = PARENT_QUICK_FILTER_GROUPS.flatMap((group) => (
  group.options.map((option) => option.value)
));
const parentQuickFilterSet = new Set<string>(parentQuickFilterOrder);
const limitFilterTypes = new Map<ParentQuickFilter, AccountLimitType>([
  ['weekly', 'weekly'],
  ['monthly', 'monthly'],
  ['limit-unknown', 'unknown']
]);

export function normalizeParentQuickFilters(values: readonly string[]): ParentQuickFilter[] {
  const validValues = values.filter((value): value is ParentQuickFilter => parentQuickFilterSet.has(value));
  return PARENT_QUICK_FILTER_GROUPS.flatMap((group) => {
    const groupValues = new Set<string>(group.options.map((option) => option.value));
    const requested = validValues.filter((value) => groupValues.has(value));
    if (group.selection === 'single') return requested.slice(-1);
    const requestedSet = new Set(requested);
    return group.options
      .map((option) => option.value)
      .filter((value) => requestedSet.has(value));
  });
}

export function parseParentQuickFilters(value?: string | null): ParentQuickFilter[] {
  if (!value) return [];
  return normalizeParentQuickFilters(value.split(',').map((item) => item.trim()).filter(Boolean));
}

export function serializeParentQuickFilters(filters: readonly ParentQuickFilter[]): string {
  return normalizeParentQuickFilters(filters).join(',');
}

export function readParentQuickFilterPreference(): ParentQuickFilter[] {
  return parseParentQuickFilters(readLocalPreference(PARENT_QUICK_FILTER_PREFERENCE_KEY));
}

export function rememberParentQuickFilterPreference(filters: readonly ParentQuickFilter[]): void {
  rememberLocalPreference(PARENT_QUICK_FILTER_PREFERENCE_KEY, serializeParentQuickFilters(filters));
}

export function parentMatchesQuickFilters(
  account: AccountSummaryView,
  accountManagerStatus: ParentAccountManagerStatus | undefined,
  maintainedAccountIds: ReadonlySet<string>,
  filters: readonly ParentQuickFilter[]
): boolean {
  if (filters.length === 0) return true;
  const selected = new Set(filters);
  const isGam = Boolean(account.managedAccountEmail);
  if (selected.has('gam') && !isGam) return false;
  if (selected.has('non-gam') && isGam) return false;

  const hasTeamSubscription = Boolean(
    accountManagerStatus?.hasTeamSubscription || account.hasTeamSubscription
  );
  const hasCodexSpace = hasParentCodexSpace(account, accountManagerStatus);
  if (selected.has('codex') && !hasCodexSpace) return false;
  if (selected.has('no-codex') && hasCodexSpace) return false;
  if (selected.has('team') && !hasTeamSubscription) return false;
  if (selected.has('no-team') && hasTeamSubscription) return false;

  const selectedLimitTypes = filters
    .map((filter) => limitFilterTypes.get(filter))
    .filter((limitType): limitType is AccountLimitType => Boolean(limitType));
  if (selectedLimitTypes.length > 0 && (
    !hasTeamSubscription
    || !selectedLimitTypes.includes(account.limitType ?? 'unknown')
  )) return false;

  if (selected.has('banned') && !account.isBanned) return false;
  if (selected.has('not-banned') && account.isBanned) return false;
  if (selected.has('maintained') && !maintainedAccountIds.has(account.id)) return false;
  if (selected.has('not-maintained') && maintainedAccountIds.has(account.id)) return false;
  return true;
}
