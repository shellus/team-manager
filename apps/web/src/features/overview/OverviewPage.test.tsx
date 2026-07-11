import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AccountView } from '@team-manager/shared';
import { StaticRouter } from 'react-router-dom';
import { describe, expect, test } from 'vitest';
import { OverviewPage } from './OverviewPage.js';

describe('OverviewPage role tags', () => {
  test('renders analyst and member roles with different tag colors', () => {
    const account: AccountView = {
      id: 'team-role-tags',
      groupName: '默认分组',
      limitType: 'unknown',
      accountId: 'workspace-role-tags',
      email: 'owner@example.com',
      workspaceName: 'Role Tag Team',
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
        createElement(OverviewPage, { accounts: [account], loading: false })
      )
    );

    expect(html).toMatch(/ant-tag-cyan[^>]*>分析者<\/span>/);
    expect(html).toMatch(/ant-tag-green[^>]*>成员<\/span>/);
  });
});
