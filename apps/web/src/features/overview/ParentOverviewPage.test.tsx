import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildParentOverviewItems, type AccountOverviewView, type ParentOverviewPageView } from '@team-manager/shared';
import { StaticRouter } from 'react-router-dom';
import { describe, expect, test } from 'vitest';
import { ParentOverviewPage } from './ParentOverviewPage.js';

describe('ParentOverviewPage', () => {
  const accounts: AccountOverviewView[] = [
    {
      id: 'later', accountId: 'workspace-later', email: 'later@example.com', workspaceName: 'Later Team',
      remark: '后扣款', limitType: 'monthly', nextRenewalOn: '2026-08-20 12:00:00', hasTeamSubscription: true
    },
    {
      id: 'first', accountId: 'workspace-first', email: 'first@example.com', workspaceName: 'First Team',
      remark: '先扣款', limitType: 'weekly', nextRenewalOn: '2026-08-16 20:11:58', hasTeamSubscription: true,
      seatSlots: [{
        seatKey: 'seat-first', email: 'member@example.com', remark: '客户甲', expiresOn: '2026-09-01',
        price: '68', seat: 'default', status: 'member', expireRemove: false, expireReminder: false, updatedAt: 1
      }]
    },
    {
      id: 'banned', accountId: 'workspace-banned', email: 'banned@example.com', workspaceName: 'Banned Team',
      isBanned: true, hasTeamSubscription: true
    },
    {
      id: 'codex', accountId: 'workspace-codex', email: 'codex@example.com', workspaceName: 'Codex Team',
      hasTeamSubscription: false
    }
  ];

  test('shows only unbanned double-seat Teams in expected-charge order', () => {
    const items = buildParentOverviewItems(accounts);
    items[0] = {
      ...items[0]!,
      renewalBilling: { amount: 1100, currency: 'GBP', cnyAmount: 9986, exchangeRate: 9.078, exchangeRateDate: '2026-08-10' }
    };
    expect(items.map((item) => item.id)).toEqual(['first', 'later']);
    const overview: ParentOverviewPageView = { items, total: items.length, page: 1, pageSize: 60 };
    const html = renderToStaticMarkup(createElement(
      StaticRouter,
      { location: '/parent-overview' },
      createElement(ParentOverviewPage, { initialOverview: overview })
    ));
    expect(html.indexOf('First Team')).toBeLessThan(html.indexOf('Later Team'));
    expect(html).not.toContain('Banned Team');
    expect(html).not.toContain('Codex Team');
    expect(html).toContain('周限');
    expect(html).toContain('GBP');
    expect(html).toContain('£11.00');
    expect(html).toContain('¥99.86');
    expect(html).toContain('客户甲');
    expect(html).toContain('68');
  });

  test('enables visual masking only when requested in the URL', () => {
    const items = buildParentOverviewItems(accounts.slice(0, 1));
    const overview: ParentOverviewPageView = { items, total: 1, page: 1, pageSize: 60 };
    const html = renderToStaticMarkup(createElement(
      StaticRouter,
      { location: '/parent-overview?masked=1' },
      createElement(ParentOverviewPage, { initialOverview: overview })
    ));
    expect(html).toContain('sensitive-text-masked');
  });
});
