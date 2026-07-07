import { describe, expect, test } from 'vitest';
import type { SubaccountTeamLink } from '@team-manager/shared';
import { parseWorkspaceIds, visibleTeamLinks } from './subaccountTeamLinks.js';

describe('subaccount Team link helpers', () => {
  test('filters removed Team links out of the visible list', () => {
    const links: SubaccountTeamLink[] = [
      { accountId: 'workspace-a', workspaceId: 'workspace-a', seat: 'default', status: 'member', updatedAt: 1 },
      { accountId: 'workspace-b', workspaceId: 'workspace-b', seat: 'default', status: 'removed', updatedAt: 2 }
    ];

    expect(visibleTeamLinks(links).map((link) => link.accountId)).toEqual(['workspace-a']);
  });

  test('extracts unique workspace UUIDs from pasted K12 text', () => {
    const ids = parseWorkspaceIds(`
      Team A 11111111-1111-4111-8111-111111111111
      Team B: 22222222-2222-4222-8222-222222222222
      duplicate 11111111-1111-4111-8111-111111111111
    `);

    expect(ids).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222'
    ]);
  });
});
