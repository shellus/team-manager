import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { accountSummaryFromView, type AccountView, type ParentRegistrationTaskView } from '@team-manager/shared';
import { ParentList } from './ParentList.js';

const registeringTask: ParentRegistrationTaskView = {
  registration: {
    id: 'registration-1',
    accountId: 'parent@example.com',
    type: 'register',
    status: 'running',
    phase: 'registration_password_filled',
    message: '正在注册账号',
    progress: 55,
    createdAt: 1,
    updatedAt: 2
  },
  stage: 'registering',
  email: 'parent@example.com'
};

const parentView: AccountView = {
  id: 'parent-1',
  managedAccountEmail: 'parent@example.com',
  groupName: '默认分组',
  limitType: 'unknown',
  accountId: 'personal-account',
  email: 'parent@example.com',
  status: 'unknown',
  hasTeamSubscription: false,
  canManageWorkspace: false
};
const parent = accountSummaryFromView(parentView);

function renderList(overrides: Partial<Parameters<typeof ParentList>[0]> = {}) {
  return renderToStaticMarkup(
    <ParentList
      groups={[]}
      activeGroup="all"
      accounts={[]}
      accountManagerStatuses={{}}
      registrationTasks={[]}
      searchQuery=""
      selectedId=""
      syncingIds={new Set()}
      runtimeStatus={{ configured: true, reachable: true }}
      isBusy={() => false}
      onGroupChange={() => undefined}
      onSearchChange={() => undefined}
      onSelect={() => undefined}
      onRefreshAccount={() => undefined}
      onOpenDelete={() => undefined}
      onOpenRegister={() => undefined}
      onOpenImport={() => undefined}
      onRetryRegistration={() => undefined}
      onRotateRegistrationIp={() => undefined}
      onRotateOperationIp={() => undefined}
      onTerminateOperation={() => undefined}
      onDismissOperation={() => undefined}
      {...overrides}
    />
  );
}

describe('ParentList', () => {
  test('keeps account registration independent from the 0.52 action', () => {
    const html = renderList({ registrationTasks: [registeringTask] });

    expect(html).toContain('自动注册');
    expect(html).toContain('录入母号');
    expect(html).toContain('parent@example.com');
    expect(html).not.toContain('开通 0.52');
  });

  test('allows changing IP from any parent registration manual stage', () => {
    const html = renderList({
      registrationTasks: [{
        ...registeringTask,
        registration: {
          ...registeringTask.registration,
          status: 'waiting_manual',
          phase: 'registration_stage_waiting_manual',
          message: '页面提交后暂未推进'
        },
        stage: 'waiting_manual'
      }]
    });

    expect(html).toContain('等待人工');
    expect(html).toContain('更换IP');
  });

  test('marks GAM, 0.52 and two-seat Team state on each parent row', () => {
    const html = renderList({
      accounts: [parent],
      accountManagerStatuses: {
        [parent.id]: {
          configured: true,
          reachable: true,
          managed: true,
          hasCodexSpace: true,
          hasTeamSubscription: false,
          accountEmail: parent.email
        }
      }
    });

    expect(html).toContain('GAM');
    expect(html).toContain('0.52');
    expect(html).toContain('未开双席位');
    expect(html).toContain('已发现 Workspace，等待同步');
  });

  test('uses the local derived Team status for a legacy parent without GAM', () => {
    const html = renderList({
      accounts: [{
        ...parent,
        managedAccountEmail: undefined,
        planType: 'team',
        hasTeamSubscription: true,
        canManageWorkspace: true
      }]
    });

    expect(html).toContain('非 GAM');
    expect(html).toContain('双席位');
    expect(html).not.toContain('未开双席位');
    expect(html).not.toContain('未开 0.52');
  });

  test('shows workspace data for a legacy usage-based parent without marking it as Team', () => {
    const html = renderList({
      accounts: [accountSummaryFromView({
          ...parentView,
          managedAccountEmail: undefined,
          planType: 'self_serve_business_usage_based',
          membersCache: [{
          userId: 'owner',
          email: parentView.email,
          role: 'account-owner',
          seat: 'usage_based'
          }],
          hasTeamSubscription: false,
          canManageWorkspace: true
      })]
    });

    expect(html).toContain('成员/邀请 1');
    expect(html).toContain('0.52 Workspace');
    expect(html).toContain('0.52');
    expect(html).not.toContain('未开 0.52');
    expect(html).not.toContain('ChatGPT 0 / 2');
    expect(html).toContain('未开双席位');
    expect(html).not.toContain('尚无可管理 Workspace');
  });

  test('renders independent 0.52 and Team operation progress on the parent row', () => {
    const html = renderList({
      accounts: [parent],
      accountManagerStatuses: {
        [parent.id]: {
          configured: true,
          reachable: true,
          managed: true,
          hasCodexSpace: false,
          hasTeamSubscription: false,
          accountEmail: parent.email,
          codexOperation: {
            id: 'codex-1',
            accountId: parent.id,
            type: 'open_codex_space',
            status: 'running',
            phase: 'payment_processing',
            message: 'Pay 已触发，正在等待 Stripe 返回付款结果',
            progress: 65,
            createdAt: 1,
            updatedAt: 3
          },
          teamOperation: {
            id: 'team-1',
            accountId: parent.id,
            type: 'open_team_subscription',
            status: 'failed',
            phase: 'operation_failed',
            progress: 100,
            errorMessage: 'Discount code is not eligible',
            createdAt: 1,
            updatedAt: 2
          }
        }
      }
    });

    expect(html).toContain('0.52 开通');
    expect(html).toContain('执行中');
    expect(html).toContain('Pay 已触发，正在等待 Stripe 返回付款结果');
    expect(html).toContain('65%');
    expect(html).toContain('更换IP');
    expect(html).toContain('终止任务');
  });

  test('keeps the latest failed operation visible for manual diagnosis', () => {
    const html = renderList({
      accounts: [parent],
      accountManagerStatuses: {
        [parent.id]: {
          configured: true,
          reachable: true,
          managed: true,
          hasCodexSpace: false,
          hasTeamSubscription: false,
          accountEmail: parent.email,
          teamOperation: {
            id: 'team-1',
            accountId: parent.id,
            type: 'open_team_subscription',
            status: 'failed',
            phase: 'operation_failed',
            progress: 100,
            errorMessage: 'Discount code is not eligible',
            createdAt: 1,
            updatedAt: 2
          }
        }
      }
    });

    expect(html).toContain('双席位 开通');
    expect(html).toContain('操作失败');
    expect(html).toContain('Discount code is not eligible');
    expect(html).toContain('100%');
    expect(html).toContain('aria-label="清除开通错误"');
    expect(html).not.toContain('更换IP');
    expect(html).not.toContain('终止任务');
  });
});
