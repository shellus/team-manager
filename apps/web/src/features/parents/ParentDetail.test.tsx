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

const operationControlProps = {
  busyState: {},
  onRetryPro5x: () => undefined,
  onRotatePro5x: () => undefined,
  onTerminatePro5x: () => undefined
};

describe('ParentDetail', () => {
  test('keeps Pro 5x enabled from the local GAM association without loading live status', () => {
    const html = renderToStaticMarkup(
      <ParentDetail
        {...operationControlProps}
        account={parent}
        loading={false}
        activeTab="account-manager"
        syncing={false}
        accountManagerStatus={null}
        accountManagerLoading={false}
        onTabChange={() => undefined}
        onSync={() => undefined}
        onOpenInvite={() => undefined}
        onOpenCodexSpace={() => undefined}
        onOpenTeamSubscription={() => undefined}
        onOpenPro5x={() => undefined}
        onOpenLocalProfile={() => undefined}
        onAccountChanged={() => undefined}
      />
    );

    const button = html.match(
      /<button[^>]*>(?:(?!<\/button>)[\s\S])*开通 Pro 5x(?:(?!<\/button>)[\s\S])*<\/button>/
    )?.[0] ?? '';
    expect(button).toContain('开通 Pro 5x');
    expect(button).not.toContain('disabled');
  });

  test('shows the successful Pro 5x payment card tail in the opened button', () => {
    const html = renderToStaticMarkup(
      <ParentDetail
        {...operationControlProps}
        account={{
          ...parent,
          accountManagerHasPro5x: true,
          accountManagerPro5xCardLast4: '4242'
        }}
        loading={false}
        activeTab="account-manager"
        syncing={false}
        accountManagerStatus={null}
        accountManagerLoading={false}
        onTabChange={() => undefined}
        onSync={() => undefined}
        onOpenInvite={() => undefined}
        onOpenCodexSpace={() => undefined}
        onOpenTeamSubscription={() => undefined}
        onOpenPro5x={() => undefined}
        onOpenLocalProfile={() => undefined}
        onAccountChanged={() => undefined}
      />
    );

    expect(html).toContain('已开 Pro 5x · 4242');
  });

  test('opens Workspace management when GAM has discovered a Codex Workspace', () => {
    const html = renderToStaticMarkup(
      <ParentDetail
        {...operationControlProps}
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
    expect(html).not.toContain('待处理邀请');
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
        {...operationControlProps}
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
        {...operationControlProps}
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
          hasCodexSpace: false,
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
    expect(html).toContain('刷新成员与邀请');
    expect(html).not.toContain('待处理邀请');
    expect(html).toContain('设置');
    expect(html).toContain('账单');
    expect(html).toContain('邀请成员');
    expect(html).toContain('同步 Workspace');
    expect(html).toContain('0.52');
    expect(html).not.toContain('开通 0.52');
  });

  test('hides the negative 0.52 tag after Team is recognized', () => {
    const html = renderToStaticMarkup(
      <ParentDetail
        {...operationControlProps}
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

  test('shows editable customer seat profiles for Codex members', () => {
    const html = renderToStaticMarkup(
      <ParentDetail
        {...operationControlProps}
        account={{
          ...parent,
          planType: 'self_serve_business_usage_based',
          canManageWorkspace: true,
          membersCache: [{
            userId: 'codex-user',
            email: 'codex-customer@example.com',
            role: 'standard-user',
            seat: 'usage_based'
          }],
          seatSlots: [{
            seatKey: 'codx1234efgh5678',
            email: 'codex-customer@example.com',
            remark: 'Codex 客户备注',
            expiresOn: '2026-09-01',
            seat: 'usage_based',
            status: 'member',
            currentUserId: 'codex-user',
            expireRemove: false,
            expireReminder: true,
            updatedAt: 1
          }]
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

    expect(html).toContain('Codex 客户备注');
    expect(html).toContain('编辑席位');
    expect(html).not.toContain('Codex 席位不使用客户席位资料');
  });

  test('shows disconnected local customer seats in the unified member tab with an explicit release action', () => {
    const html = renderToStaticMarkup(
      <ParentDetail
        {...operationControlProps}
        account={{
          ...parent,
          planType: 'team',
          hasTeamSubscription: true,
          canManageWorkspace: true,
          membersCache: [{
            userId: 'owner-user',
            email: 'owner@example.com',
            role: 'account-owner',
            seat: 'usage_based'
          }],
          pendingInvitesCache: [{
            inviteId: 'pending-invite',
            email: 'pending@example.com',
            role: 'standard-user',
            status: 1,
            seat: 'default',
            createdTime: '2026-08-01T00:00:00Z',
            isScimManaged: false
          }],
          seatSlots: [
            {
              seatKey: 'pend1234efgh5678',
              email: 'pending@example.com',
              expiresOn: '2026-08-15',
              seat: 'default',
              status: 'invited',
              expireRemove: false,
              expireReminder: true,
              updatedAt: 1
            },
            {
              seatKey: 'lost1234efgh5678',
              email: 'lost@example.com',
              remark: '历史客户资料',
              expiresOn: '2026-08-01',
              seat: 'default',
              status: 'unknown',
              expireRemove: false,
              expireReminder: true,
              updatedAt: 1
            }
          ]
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

    expect(html).toContain('成员');
    expect(html).toContain('pending@example.com');
    expect(html).toContain('邀请中');
    expect(html).toContain('撤销邀请');
    expect(html).toContain('lost@example.com');
    expect(html).toContain('历史客户资料');
    expect(html).toContain('关系失联');
    expect(html).toContain('释放为空位');
  });

  test('keeps local customer seats visible when the Workspace is not currently manageable', () => {
    const html = renderToStaticMarkup(
      <ParentDetail
        {...operationControlProps}
        account={{
          ...parent,
          seatSlots: [{
            seatKey: 'lost1234efgh5678',
            email: 'lost@example.com',
            expiresOn: '2026-08-01',
            seat: 'default',
            status: 'unknown',
            expireRemove: false,
            expireReminder: true,
            updatedAt: 1
          }]
        }}
        loading={false}
        activeTab="members"
        syncing={false}
        accountManagerStatus={null}
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
    expect(html).toContain('lost@example.com');
    expect(html).toContain('关系失联');
  });
});
