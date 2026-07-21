import type { AccountView, ParentAccountManagerStatus } from '@team-manager/shared';
import { Alert, Button, Card, Empty, Space, Tabs, Tag, Tooltip, Typography } from 'antd';
import {
  CreditCardOutlined,
  DeleteOutlined,
  EditOutlined,
  ReloadOutlined,
  ShoppingCartOutlined,
  UserAddOutlined
} from '@ant-design/icons';
import type { ParentTab } from '../../app/routeState.js';
import { CountedTabLabel } from '../../components/CountedTabLabel.js';
import { AccountManagerAssociationPanel } from '../../components/AccountManagerAssociationPanel.js';
import { AccountStatusTag, DefaultSeatTag } from '../../components/StatusTag.js';
import { formatRelativeTime } from '../../components/format.js';
import { ParentInvitesTable } from './ParentInvitesTable.js';
import { ParentBillingPanel } from './ParentBillingPanel.js';
import { ParentMembersTable } from './ParentMembersTable.js';
import { ParentSettingsPanel } from './ParentSettingsPanel.js';
import { canManageParentWorkspace } from './parentWorkspaceCapability.js';

export function ParentDetail({
  account,
  loading,
  activeTab,
  syncing,
  accountManagerStatus,
  accountManagerLoading,
  onTabChange,
  onSync,
  onOpenInvite,
  onOpenCodexSpace,
  onOpenTeamSubscription,
  onOpenDelete,
  onOpenLocalProfile,
  onAccountChanged
}: {
  account: AccountView | null;
  loading: boolean;
  activeTab: ParentTab;
  syncing: boolean;
  accountManagerStatus: ParentAccountManagerStatus | null;
  accountManagerLoading: boolean;
  onTabChange: (tab: ParentTab) => void;
  onSync: () => void;
  onOpenInvite: () => void;
  onOpenCodexSpace: () => void;
  onOpenTeamSubscription: () => void;
  onOpenDelete: () => void;
  onOpenLocalProfile: () => void;
  onAccountChanged: (account: AccountView) => void;
}) {
  if (loading) return <Card className="detail-pane" loading />;

  if (!account) {
    return (
      <Card className="detail-pane">
        <Empty description="还没有母号" />
      </Card>
    );
  }

  const memberCount = account.membersCache?.length;
  const inviteCount = account.pendingInvitesCache?.length;
  const title = account.remark || account.email;
  const workspaceLabel = account.workspaceName || account.accountId;
  const codexOperation = accountManagerStatus?.codexOperation;
  const teamOperation = accountManagerStatus?.teamOperation;
  const codexOpening = codexOperation?.status === 'queued' || codexOperation?.status === 'running';
  const codexWaitingManual = codexOperation?.status === 'waiting_manual';
  const teamOpening = teamOperation?.status === 'queued' || teamOperation?.status === 'running';
  const teamWaitingManual = teamOperation?.status === 'waiting_manual';
  const accountManagerUnavailable = accountManagerLoading
    || !accountManagerStatus
    || accountManagerStatus?.configured === false
    || accountManagerStatus?.reachable === false
    || accountManagerStatus?.managed === false;
  const codexButtonDisabled = accountManagerLoading
    || accountManagerUnavailable
    || accountManagerStatus?.hasCodexSpace === true
    || codexOpening
    || codexWaitingManual;
  const codexButtonTitle = accountManagerStatus?.hasCodexSpace
    ? '该 GPT 账号已开通 0.52 Codex 空间'
    : accountManagerStatus?.managed === false
      ? accountManagerStatus.error || '该邮箱未由 GPT Account Manager 管理'
      : codexWaitingManual
        ? codexOperation?.message || '付款页面等待人工处理，系统会继续监听'
        : accountManagerStatus?.error || '开通 13 Credits Workspace';
  const codexFailed = codexOperation?.status === 'failed' || codexOperation?.status === 'interrupted';
  const hasTeamSubscription = accountManagerStatus?.hasTeamSubscription || account.hasTeamSubscription;
  const canManageWorkspace = canManageParentWorkspace(account, accountManagerStatus);
  const teamButtonDisabled = accountManagerUnavailable || hasTeamSubscription || teamOpening || teamWaitingManual;
  const teamButtonTitle = hasTeamSubscription
    ? '该 GPT 账号已开通双席位 Team'
    : accountManagerStatus?.managed === false
      ? accountManagerStatus.error || '该邮箱未由 GPT Account Manager 管理'
      : teamWaitingManual
        ? teamOperation?.message || '付款页面等待人工处理，系统会继续监听'
        : accountManagerStatus?.error || '创建两个固定席位的 Team 月付订单';
  const teamFailed = teamOperation?.status === 'failed' || teamOperation?.status === 'interrupted';

  return (
    <Card className="detail-pane">
      <div className="detail-header">
        <div>
          <Space align="center">
            <Typography.Title level={2}>{title}</Typography.Title>
            <AccountStatusTag status={account.status} />
          </Space>
          <Space className="detail-meta-row" size={8} wrap>
            <Typography.Text type="secondary">{account.email}</Typography.Text>
            <Typography.Text type="secondary">{workspaceLabel}</Typography.Text>
            {account.nextRenewalOn && (
              <Typography.Text type="secondary">续费 {account.nextRenewalOn}</Typography.Text>
            )}
            <Typography.Text type="secondary">默认席位</Typography.Text>
            <DefaultSeatTag seat={account.defaultSeat} />
            <Tag color={account.managedAccountEmail ? 'blue' : 'default'}>
              {account.managedAccountEmail ? 'GAM' : '非 GAM'}
            </Tag>
            <Tag color={accountManagerStatus?.hasCodexSpace ? 'green' : 'default'}>
              {accountManagerStatus?.hasCodexSpace ? '0.52' : '未开 0.52'}
            </Tag>
            <Tag color={hasTeamSubscription ? 'green' : 'default'}>
              {hasTeamSubscription ? '双席位' : '未开双席位'}
            </Tag>
          </Space>
        </div>
        <Space wrap>
          <Typography.Text type="secondary">同步 {formatRelativeTime(account.lastRefreshAt)}</Typography.Text>
          <Button
            aria-label="邀请 Workspace 成员"
            icon={<UserAddOutlined />}
            type="primary"
            disabled={!canManageWorkspace}
            onClick={onOpenInvite}
          >
            邀请成员
          </Button>
          <Tooltip title={codexButtonTitle}>
            <span>
              <Button
                icon={<CreditCardOutlined />}
                loading={accountManagerLoading || codexOpening}
                disabled={codexButtonDisabled}
                onClick={onOpenCodexSpace}
              >
                {accountManagerStatus?.hasCodexSpace
                  ? '已开通 0.52'
                  : codexOpening
                    ? '开通中'
                    : codexWaitingManual
                      ? '等待人工处理'
                    : codexFailed
                      ? '重新开通 0.52'
                      : '开通 0.52'}
              </Button>
            </span>
          </Tooltip>
          <Tooltip title={teamButtonTitle}>
            <span>
              <Button
                icon={<ShoppingCartOutlined />}
                loading={accountManagerLoading || teamOpening}
                disabled={teamButtonDisabled}
                onClick={onOpenTeamSubscription}
              >
                {hasTeamSubscription
                  ? '已开双席位'
                  : teamOpening
                    ? '创建订单中'
                    : teamWaitingManual
                      ? '等待人工处理'
                      : teamFailed
                        ? '重新开通双席位'
                        : '开通双席位'}
              </Button>
            </span>
          </Tooltip>
          <Button icon={<EditOutlined />} onClick={onOpenLocalProfile}>
            本地资料
          </Button>
          <Tooltip title={account.canManageWorkspace
            ? '重新读取当前 Workspace 状态'
            : '从保存的 Session 发现外部开通的 0.52 或 Team Workspace'}>
            <Button
              aria-label="同步 Workspace"
              icon={<ReloadOutlined />}
              loading={syncing}
              onClick={onSync}
            >
              同步 Workspace
            </Button>
          </Tooltip>
          <Button danger icon={<DeleteOutlined />} onClick={onOpenDelete}>
            删除母号
          </Button>
        </Space>
      </div>

      {codexWaitingManual && (
        <Alert
          className="detail-operation-alert"
          type="warning"
          showIcon
          message="付款页面等待人工处理"
          description={codexOperation?.message
            || '在对应 CloakBrowser profile 中继续处理付款；系统会持续监听支付成功和 Workspace 创建。'}
        />
      )}

      {teamWaitingManual && (
        <Alert
          className="detail-operation-alert"
          type="warning"
          showIcon
          message="双席位付款等待人工处理"
          description={teamOperation?.message
            || '在对应 CloakBrowser profile 中继续付款；系统会监听成功信号并完成 Team 创建。'}
        />
      )}

      <Tabs
        activeKey={activeTab}
        onChange={(key) => onTabChange(key as ParentTab)}
        items={canManageWorkspace ? [
          {
            key: 'members',
            label: <CountedTabLabel label="成员" count={memberCount} />,
            children: (
              <ParentMembersTable
                account={account}
                onAccountChanged={onAccountChanged}
              />
            )
          },
          {
            key: 'invites',
            label: <CountedTabLabel label="待处理邀请" count={inviteCount} />,
            children: (
              <ParentInvitesTable
                account={account}
                onAccountChanged={onAccountChanged}
              />
            )
          },
          {
            key: 'account-manager',
            label: '账号管理',
            children: (
              <AccountManagerAssociationPanel
                recordLabel="母号"
                managedAccountEmail={account.managedAccountEmail}
                status={accountManagerStatus}
                loading={accountManagerLoading}
              />
            )
          },
          {
            key: 'settings',
            label: '设置',
            children: (
              <ParentSettingsPanel
                account={account}
                onAccountChanged={onAccountChanged}
                onOpenLocalProfile={onOpenLocalProfile}
              />
            )
          },
          {
            key: 'billing',
            label: '账单',
            children: <ParentBillingPanel account={account} />
          }
        ] : [{
          key: 'account-manager',
          label: '账号管理',
          children: (
            <AccountManagerAssociationPanel
              recordLabel="母号"
              managedAccountEmail={account.managedAccountEmail}
              status={accountManagerStatus}
              loading={accountManagerLoading}
            />
          )
        }]}
      />
    </Card>
  );
}
