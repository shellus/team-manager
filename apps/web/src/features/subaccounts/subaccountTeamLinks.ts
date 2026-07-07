import type { SubaccountTeamLink } from '@team-manager/shared';

const WORKSPACE_ID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export function visibleTeamLinks(links: SubaccountTeamLink[]): SubaccountTeamLink[] {
  return links.filter((link) => link.status !== 'removed');
}

export function parseWorkspaceIds(input: string): string[] {
  const normalized = input.normalize ? input.normalize('NFKC') : input;
  const candidates = normalized.replace(/[‐‑‒–—﹣－]/g, '-').match(WORKSPACE_ID_PATTERN) ?? [];
  return [...new Set(candidates.map((item) => item.toLowerCase()))];
}
