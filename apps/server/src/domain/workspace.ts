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
