import type { AccountSummaryView, AccountView, ParentAccountManagerStatus } from '@team-manager/shared';

type ParentWorkspaceCapabilityAccount = Pick<AccountView | AccountSummaryView, 'canManageWorkspace' | 'planType'>;

export function hasParentCodexSpace(
  account: Pick<AccountView | AccountSummaryView, 'planType'>,
  accountManagerStatus?: ParentAccountManagerStatus | null
): boolean {
  return account.planType === 'self_serve_business_usage_based'
    || accountManagerStatus?.hasCodexSpace === true;
}

/** 本地 Workspace 快照或 GAM 已确认的开通结果，都足以开放 Workspace 管理入口。 */
export function canManageParentWorkspace(
  account: ParentWorkspaceCapabilityAccount,
  accountManagerStatus?: ParentAccountManagerStatus | null
): boolean {
  if (account.canManageWorkspace) return true;
  return Boolean(
    accountManagerStatus?.managed
      && (accountManagerStatus.hasCodexSpace || accountManagerStatus.hasTeamSubscription)
  );
}
