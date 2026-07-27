import type { AccountManagerProfileView } from '@team-manager/shared';
import { Tag } from 'antd';

export type AccountProfileStatuses = Record<string, AccountManagerProfileView>;

export function accountProfileIsRunning(profile: AccountManagerProfileView | undefined): boolean {
  return profile?.status === 'running';
}

export function compareRunningProfileFirst<T extends { id: string }>(
  left: T,
  right: T,
  profiles: AccountProfileStatuses,
  fallback: (left: T, right: T) => number
): number {
  const runningDifference = Number(accountProfileIsRunning(profiles[right.id]))
    - Number(accountProfileIsRunning(profiles[left.id]));
  return runningDifference || fallback(left, right);
}

export function RunningProfileTag({
  profile
}: {
  profile?: AccountManagerProfileView;
}) {
  return accountProfileIsRunning(profile) ? <Tag color="success">Profile 已启动</Tag> : null;
}
