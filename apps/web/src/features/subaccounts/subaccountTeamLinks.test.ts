import { describe, expect, test } from 'vitest';
import type { SubaccountTeamLink } from '@team-manager/shared';
import { visibleTeamLinks } from './subaccountTeamLinks.js';

describe('subaccount Team link helpers', () => {
  test('filters removed Team links out of the visible list', () => {
    const links: SubaccountTeamLink[] = [
      { accountId: 'workspace-a', workspaceId: 'workspace-a', seat: 'default', status: 'member', updatedAt: 1 },
      { accountId: 'workspace-b', workspaceId: 'workspace-b', seat: 'default', status: 'removed', updatedAt: 2 }
    ];

    expect(visibleTeamLinks(links).map((link) => link.accountId)).toEqual(['workspace-a']);
  });
});
