import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { accountSummaryFromView, type AccountView, type ParentRegistrationTaskView } from '@team-manager/shared';
import { ParentList, stopParentActionMenuPropagation } from './ParentList.js';

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
      activeGroup=""
      accounts={[]}
      accountManagerStatuses={{}}
      accountProfileStatuses={{}}
      registrationTasks={[]}
      searchQuery=""
      quickFilters={[]}
      selectedId=""
      syncingIds={new Set()}
      runtimeStatus={{ configured: true, reachable: true }}
      isBusy={() => false}
      onGroupChange={() => undefined}
      onSearchChange={() => undefined}
      onQuickFiltersChange={() => undefined}
      onSelect={() => undefined}
      onRefreshAccount={() => undefined}
      onOpenDelete={() => undefined}
      onOpenRegister={() => undefined}
      onOpenImport={() => undefined}
      onRetryRegistration={() => undefined}
      onCancelRegistration={() => undefined}
      onSelectRegistration={() => undefined}
      onTerminateOperation={() => undefined}
      onDismissOperation={() => undefined}
      {...overrides}
    />
  );
}

describe('ParentList', () => {
  test('stops dropdown actions from bubbling into the parent card selection', () => {
    let propagationStopped = false;

    stopParentActionMenuPropagation({
      domEvent: {
        stopPropagation: () => {
          propagationStopped = true;
        }
      }
    });

    expect(propagationStopped).toBe(true);
  });

  test('keeps account registration independent from the 0.52 action', () => {
    const html = renderList({ registrationTasks: [registeringTask] });

    expect(html).toContain('自动注册');
    expect(html).toContain('录入母号');
    expect(html).toContain('parent@example.com');
    expect(html).toContain('取消任务');
    expect(html).not.toContain('开通 0.52');
  });

  test('labels a user-cancelled parent registration and keeps retry available', () => {
    const html = renderList({
      registrationTasks: [{
        ...registeringTask,
        registration: {
          ...registeringTask.registration,
          status: 'interrupted',
          phase: 'registration_cancelled',
          message: '注册任务已取消'
        },
        stage: 'registration_failed'
      }]
    });

    expect(html).toContain('已取消');
    expect(html).toContain('重试注册');
    expect(html).not.toContain('取消任务');
  });

  test('keeps proxy configuration out of the parent registration status card', () => {
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
    expect(html).not.toContain('更换IP');
  });

  test('shows opened 0.52 without rendering a negative two-seat Team tag', () => {
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

    expect(html).toMatch(/ant-tag-green[^>]*>0\.52/);
    expect(html).not.toContain('未开双席位');
    expect(html).toContain('已发现 Workspace，等待同步');
    expect(html).not.toContain('limit-type-unknown');
  });

  test('marks a manually banned parent account', () => {
    const html = renderList({ accounts: [{ ...parent, isBanned: true }] });

    expect(html).toContain('已封号');
  });

  test('marks a parent whose manual Profile is running', () => {
    const html = renderList({
      accounts: [parent],
      accountProfileStatuses: {
        [parent.id]: {
          accountId: parent.email,
          status: 'running',
          profileId: 'runtime-profile',
          updatedAt: 1
        }
      }
    });

    expect(html).toContain('Profile 已启动');
  });

  test('renders the Pro 5x capability tag from the persisted local state', () => {
    const html = renderList({
      accounts: [{ ...parent, accountManagerHasPro5x: true }]
    });

    expect(html).toContain('Pro 5x');
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
    expect(html).not.toContain('未开双席位');
    expect(html).not.toContain('limit-type-unknown');
    expect(html).not.toContain('尚无可管理 Workspace');
  });

  test('shows the configured limit tag only for a two-seat Team parent', () => {
    const html = renderList({
      accounts: [{ ...parent, hasTeamSubscription: true, canManageWorkspace: true, limitType: 'monthly' }]
    });

    expect(html).toContain('limit-type-monthly');
    expect(html).toContain('月限');
  });

  test('renders all quick tag filters and marks the active filter', () => {
    const html = renderList({ quickFilters: ['codex', 'team'] });

    expect(html).toContain('快捷筛选');
    expect(html).toContain('GAM');
    expect(html).toContain('0.52');
    expect(html).toContain('双席位');
    expect(html.match(/>是</g)).toHaveLength(5);
    expect(html.match(/>否</g)).toHaveLength(5);
    expect(html).toContain('周限');
    expect(html).toContain('月限');
    expect(html).toContain('封号');
    expect(html).toContain('订单维护');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(2);
    expect(html).toContain('清除');
  });

  test('hides registration tasks while account tag filters are active', () => {
    const html = renderList({ registrationTasks: [registeringTask], quickFilters: ['team'] });

    expect(html).not.toContain('parent@example.com');
    expect(html).toContain('没有匹配筛选条件的母号');
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
    expect(html).not.toContain('更换IP');
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
