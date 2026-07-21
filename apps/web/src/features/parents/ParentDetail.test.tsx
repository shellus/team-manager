import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import type { AccountView } from '@team-manager/shared';
import { ParentDetail } from './ParentDetail.js';

const parent: AccountView = {
  id: 'parent-1',
  managedAccountEmail: 'owner@example.com',
  groupName: '默认分组',
  limitType: 'unknown',
  accountId: 'personal-account',
  email: 'owner@example.com',
  status: 'unknown',
  hasTeamSubscription: false,
  canManageWorkspace: false
};

describe('ParentDetail', () => {
  test('opens Workspace management when GAM has discovered a Codex Workspace', () => {
    const html = renderToStaticMarkup(
      <ParentDetail
        account={parent}
        loading={false}
        activeTab="account-manager"
        syncing={false}
        accountManagerStatus={{
          configured: true,
          reachable: true,
          managed: true,
          hasCodexSpace: true,
          hasTeamSubscription: false,
          accountEmail: parent.email
        }}
        accountManagerLoading={false}
        onTabChange={() => undefined}
        onSync={() => undefined}
        onOpenInvite={() => undefined}
        onOpenCodexSpace={() => undefined}
        onOpenTeamSubscription={() => undefined}
        onOpenLocalProfile={() => undefined}
        onAccountChanged={() => undefined}
      />
    );

    expect(html).toContain('账号管理');
    expect(html).toContain('GPT Account Manager 关联');
    expect(html).toContain('owner@example.com');
    expect(html).toContain('成员');
    expect(html).toContain('待处理邀请');
    expect(html).toContain('设置');
    expect(html).toContain('账单');
    expect(html).toContain('邀请成员');
    expect(html).toContain('同步 Workspace');
    expect(html).toContain('detail-capability-tags');
    expect(html).not.toContain('已开通 0.52');
    expect(html).not.toContain('删除母号');
    expect(html).not.toMatch(/同步\s+(刚刚|\d|暂无)/);
    expect(html).not.toMatch(/<button(?=[^>]*aria-label="邀请 Workspace 成员")[^>]*disabled/);
    expect(html).not.toMatch(/<button(?=[^>]*aria-label="同步 Workspace")[^>]*disabled/);
  });

  test('keeps Workspace sync enabled for a personal parent without a known Workspace', () => {
    const html = renderToStaticMarkup(
      <ParentDetail
        account={parent}
        loading={false}
        activeTab="account-manager"
        syncing={false}
        accountManagerStatus={{
          configured: true,
          reachable: true,
          managed: true,
          hasCodexSpace: false,
          hasTeamSubscription: false,
          accountEmail: parent.email
        }}
        accountManagerLoading={false}
        onTabChange={() => undefined}
        onSync={() => undefined}
        onOpenInvite={() => undefined}
        onOpenCodexSpace={() => undefined}
        onOpenTeamSubscription={() => undefined}
        onOpenLocalProfile={() => undefined}
        onAccountChanged={() => undefined}
      />
    );

    expect(html).toContain('同步 Workspace');
    expect(html).not.toMatch(/<button(?=[^>]*aria-label="同步 Workspace")[^>]*disabled/);
    expect(html).toMatch(/<button(?=[^>]*aria-label="邀请 Workspace 成员")[^>]*disabled/);
  });

  test('keeps workspace operations enabled for a legacy usage-based parent', () => {
    const html = renderToStaticMarkup(
      <ParentDetail
        account={{
          ...parent,
          planType: 'self_serve_business_usage_based',
          hasTeamSubscription: false,
          canManageWorkspace: true
        }}
        loading={false}
        activeTab="members"
        syncing={false}
        accountManagerStatus={{
          configured: true,
          reachable: true,
          managed: false,
          hasCodexSpace: true,
          hasTeamSubscription: false
        }}
        accountManagerLoading={false}
        onTabChange={() => undefined}
        onSync={() => undefined}
        onOpenInvite={() => undefined}
        onOpenCodexSpace={() => undefined}
        onOpenTeamSubscription={() => undefined}
        onOpenLocalProfile={() => undefined}
        onAccountChanged={() => undefined}
      />
    );

    expect(html).toContain('成员');
    expect(html).toContain('待处理邀请');
    expect(html).toContain('设置');
    expect(html).toContain('账单');
    expect(html).toContain('邀请成员');
    expect(html).toContain('同步 Workspace');
  });

  test('hides the negative 0.52 tag after Team is recognized', () => {
    const html = renderToStaticMarkup(
      <ParentDetail
        account={{
          ...parent,
          planType: 'self_serve_business_usage_based',
          hasTeamSubscription: true,
          canManageWorkspace: true
        }}
        loading={false}
        activeTab="members"
        syncing={false}
        accountManagerStatus={{
          configured: true,
          reachable: true,
          managed: false,
          hasCodexSpace: false,
          hasTeamSubscription: true
        }}
        accountManagerLoading={false}
        onTabChange={() => undefined}
        onSync={() => undefined}
        onOpenInvite={() => undefined}
        onOpenCodexSpace={() => undefined}
        onOpenTeamSubscription={() => undefined}
        onOpenLocalProfile={() => undefined}
        onAccountChanged={() => undefined}
      />
    );

    expect(html).toContain('双席位');
    expect(html).not.toContain('未开 0.52');
  });
});
