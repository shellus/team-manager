import type { AccountSummaryView, AccountView, ParentAccountManagerStatus } from '@team-manager/shared';

type ParentWorkspaceCapabilityAccount = Pick<AccountView | AccountSummaryView, 'canManageWorkspace'>;

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
