import type { SubaccountTeamLink } from '@team-manager/shared';

export function visibleTeamLinks(links: SubaccountTeamLink[]): SubaccountTeamLink[] {
  return links.filter((link) => link.status !== 'removed');
}
