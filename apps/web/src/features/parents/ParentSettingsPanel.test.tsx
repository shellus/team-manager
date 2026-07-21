import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import type { AccountView } from '@team-manager/shared';
import { ParentSettingsPanel } from './ParentSettingsPanel.js';

const account: AccountView = {
  id: 'parent-1',
  groupName: '默认分组',
  limitType: 'unknown',
  accountId: 'workspace-1',
  email: 'owner@example.com',
  planType: 'self_serve_business_usage_based',
  status: 'active',
  automaticReloadEnabled: true,
  automaticReloadCachedAt: 1,
  hasTeamSubscription: false,
  canManageWorkspace: true
};

describe('ParentSettingsPanel', () => {
  test('shows the cached Automatic reload setting and billing warning', () => {
    const html = renderToStaticMarkup(
      <ParentSettingsPanel
        account={account}
        onAccountChanged={() => undefined}
        onOpenLocalProfile={() => undefined}
      />
    );

    expect(html).toContain('Automatic reload');
    expect(html).toContain('Credits 余额不足时自动使用默认支付方式补款');
    expect(html).toContain('开启');
  });
});
