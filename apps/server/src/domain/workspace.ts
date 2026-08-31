export type NormalizedWorkspacePlan = 'free' | 'business' | 'business_usage_based' | 'unknown';
export type NormalizedWorkspaceRole = 'owner' | 'admin' | 'member' | 'analytics_viewer' | 'unknown';

export function normalizeWorkspacePlan(value?: string): NormalizedWorkspacePlan {
  const key = value?.toLowerCase() ?? '';
  if (key.includes('usage')) return 'business_usage_based';
  if (key.includes('business') || key.includes('team')) return 'business';
  if (key === 'free') return 'free';
  return 'unknown';
}

export function normalizeWorkspaceRole(value?: string): NormalizedWorkspaceRole {
  const key = value?.toLowerCase() ?? '';
  if (key.includes('owner')) return 'owner';
  if (key.includes('admin')) return 'admin';
  if (key.includes('analytics')) return 'analytics_viewer';
  if (key.includes('member') || key.includes('user')) return 'member';
  return 'unknown';
}

/**
 * accounts/check 返回的 account_user_id 可能追加 __<workspace account id>，
 * 成员列表接口使用的则是可执行成员操作的基础 user id。
 */
export function normalizeWorkspaceMemberUserId(value: string | undefined, workspaceExternalId: string): string | undefined {
  const userId = value?.trim();
  if (!userId) return undefined;
  const suffix = `__${workspaceExternalId.trim()}`;
  return suffix.length > 2 && userId.endsWith(suffix) ? userId.slice(0, -suffix.length) : userId;
}
