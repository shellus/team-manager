import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AccountOverviewView } from '@team-manager/shared';
import { StaticRouter } from 'react-router-dom';
import { describe, expect, test } from 'vitest';
import { OverviewPage } from './OverviewPage.js';

describe('OverviewPage role tags', () => {
  test('renders analyst and member roles with different tag colors', () => {
    const account: AccountOverviewView = {
      id: 'team-role-tags',
      accountId: 'workspace-role-tags',
      email: 'owner@example.com',
      workspaceName: 'Role Tag Team',
      hasTeamSubscription: true,
      membersCache: [
        {
          userId: 'analyst-user',
          email: 'analyst@example.com',
          role: 'analytics-viewer',
          seat: 'default'
        },
        {
          userId: 'member-user',
          email: 'member@example.com',
          role: 'standard-user',
          seat: 'default'
        }
      ]
    };

    const html = renderToStaticMarkup(
      createElement(
        StaticRouter,
        { location: '/' },
        createElement(OverviewPage, { initialAccounts: [account] })
      )
    );

    expect(html).toMatch(/ant-tag-cyan[^>]*>分析者<\/span>/);
    expect(html).toMatch(/ant-tag-green[^>]*>成员<\/span>/);
  });

  test('does not render an empty seat for a Codex-only Workspace', () => {
    const account: AccountOverviewView = {
      id: 'codex-only',
      accountId: 'workspace-codex-only',
      email: 'owner@example.com',
      hasTeamSubscription: false
    };

    const html = renderToStaticMarkup(
      createElement(
        StaticRouter,
        { location: '/' },
        createElement(OverviewPage, { initialAccounts: [account] })
      )
    );

    expect(html).not.toContain('空位');
    expect(html).toContain('还没有可展示的位置');
  });
});
