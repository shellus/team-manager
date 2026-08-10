import type {
  AccountManagerProfileView,
  AccountView,
  ParentAccountManagerStatus
} from '@team-manager/shared';
import { Alert, Button, Card, Empty, Space, Tabs, Tag, Tooltip, Typography } from 'antd';
import {
  CreditCardOutlined,
  CrownOutlined,
  EditOutlined,
  ReloadOutlined,
  ShoppingCartOutlined,
  UserAddOutlined
} from '@ant-design/icons';
import type { ParentTab } from '../../app/routeState.js';
import { CountedTabLabel } from '../../components/CountedTabLabel.js';
import { AccountManagerAssociationPanel } from '../../components/AccountManagerAssociationPanel.js';
import type { ActionBusyState } from '../../components/actionBusy.js';
import { Pro5xOperationActions } from '../../components/Pro5xOperationActions.js';
import { AccountStatusTag, DefaultSeatTag } from '../../components/StatusTag.js';
import { WorkspaceOpeningStatusTags } from '../../components/WorkspaceOpeningStatusTags.js';
import {
  hasManagedAccountReference,
  hasPro5xFromLocalState,
  openedPro5xButtonLabel
} from '../../components/accountManagerLocalState.js';
import { ParentBillingPanel } from './ParentBillingPanel.js';
import { ParentMembersTable } from './ParentMembersTable.js';
import { buildParentMemberRows } from './parentMemberRows.js';
import { ParentSettingsPanel } from './ParentSettingsPanel.js';
import { ParentOrderMaintenancePanel } from './ParentOrderMaintenancePanel.js';
import { canManageParentWorkspace, hasParentCodexSpace } from './parentWorkspaceCapability.js';

export function ParentDetail({
  account,
  loading,
  activeTab,
  syncing,
  accountManagerStatus,
  accountManagerLoading,
  busyState,
  onTabChange,
  onSync,
  onOpenInvite,
  onOpenCodexSpace,
  onOpenTeamSubscription,
  onOpenPro5x,
  onAddPersonalPaymentMethod,
  onRetryPro5x,
  onRotatePro5x,
  onTerminatePro5x,
  onOpenLocalProfile,
  onAccountChanged,
  onAccountManagerStatusChanged,
  onAccountProfileChanged
}: {
  account: AccountView | null;
  loading: boolean;
  activeTab: ParentTab;
  syncing: boolean;
  accountManagerStatus: ParentAccountManagerStatus | null;
  accountManagerLoading: boolean;
  busyState: ActionBusyState;
  onTabChange: (tab: ParentTab) => void;
  onSync: () => void;
  onOpenInvite: () => void;
  onOpenCodexSpace: () => void;
  onOpenTeamSubscription: () => void;
  onOpenPro5x?: () => void;
  onAddPersonalPaymentMethod?: () => void;
  onRetryPro5x: (operationId: string) => void;
  onRotatePro5x: (operationId: string) => void;
  onTerminatePro5x: (operationId: string) => void;
  onOpenLocalProfile: () => void;
  onAccountChanged: (account: AccountView) => void;
  onAccountManagerStatusChanged?: (status: ParentAccountManagerStatus) => void;
  onAccountProfileChanged?: (profile: AccountManagerProfileView) => void;
}) {
  if (loading) return <Card className="detail-pane" loading />;

  if (!account) {
    return (
      <Card className="detail-pane">
        <Empty description="还没有母号" />
      </Card>
    );
  }

  const memberRowCount = buildParentMemberRows(account).length;
  const title = account.remark || account.email;
  const workspaceLabel = account.workspaceName || account.accountId;
  const codexOperation = accountManagerStatus?.codexOperation;
  const teamOperation = accountManagerStatus?.teamOperation;
  const pro5xOperation = accountManagerStatus?.pro5xOperation;
  const codexOpening = codexOperation?.status === 'queued' || codexOperation?.status === 'running';
  const codexWaitingManual = codexOperation?.status === 'waiting_manual';
  const teamOpening = teamOperation?.status === 'queued' || teamOperation?.status === 'running';
  const teamWaitingManual = teamOperation?.status === 'waiting_manual';
  const pro5xOpening = pro5xOperation?.status === 'queued' || pro5xOperation?.status === 'running';
  const pro5xWaitingManual = pro5xOperation?.status === 'waiting_manual';
  const pro5xNeedsCard = pro5xWaitingManual && pro5xOperation?.phase === 'pro5x_payment_card_required';
  const hasCodexSpace = hasParentCodexSpace(account, accountManagerStatus);
  const locallyManaged = hasManagedAccountReference(account.managedAccountEmail);
  const accountManagerUnavailable = !locallyManaged;
  const codexButtonDisabled = accountManagerLoading
    || accountManagerUnavailable
    || codexOpening
    || codexWaitingManual;
  const codexButtonTitle = accountManagerUnavailable
      ? '该母号尚未关联 GPT Account Manager'
      : codexWaitingManual
        ? codexOperation?.message || '付款页面等待人工处理，系统会继续监听'
        : accountManagerStatus?.error || '开通 13 Credits Workspace';
  const codexFailed = codexOperation?.status === 'failed' || codexOperation?.status === 'interrupted';
  const hasTeamSubscription = accountManagerStatus?.hasTeamSubscription || account.hasTeamSubscription;
  const hasPro5x = hasPro5xFromLocalState(
    account.accountManagerHasPro5x,
    accountManagerStatus?.hasPro5x
  );
  const effectiveAccountManagerStatus = accountManagerStatus
    ? {
        ...accountManagerStatus,
        managed: locallyManaged || accountManagerStatus.managed,
        hasCodexSpace,
        hasTeamSubscription,
        hasPro5x,
        ...(account.managedAccountEmail ? { accountEmail: account.managedAccountEmail } : {})
      }
    : accountManagerStatus;
  const canManageWorkspace = canManageParentWorkspace(account, accountManagerStatus);
  const teamButtonDisabled = accountManagerUnavailable || hasTeamSubscription || teamOpening || teamWaitingManual;
  const teamButtonTitle = hasTeamSubscription
    ? '该 GPT 账号已开通双席位 Team'
    : accountManagerUnavailable
      ? '该母号尚未关联 GPT Account Manager'
      : teamWaitingManual
        ? teamOperation?.message || '付款页面等待人工处理，系统会继续监听'
        : accountManagerStatus?.error || '创建两个固定席位的 Team 月付订单';
  const teamFailed = teamOperation?.status === 'failed' || teamOperation?.status === 'interrupted';
  const pro5xButtonDisabled = accountManagerUnavailable
    || hasPro5x
    || pro5xOpening
    || (pro5xWaitingManual && !pro5xNeedsCard);
  const pro5xButtonTitle = hasPro5x
    ? '该 GPT 个人账号已开通 Pro 5x'
    : accountManagerUnavailable
      ? '该母号尚未关联 GPT Account Manager'
      : pro5xWaitingManual
        ? pro5xOperation?.message || '站内付款等待人工处理，系统会继续监听'
        : accountManagerStatus?.error || '使用新加坡指定 ASN 出口开通 Pro 5x';
  const pro5xFailed = pro5xOperation?.status === 'failed' || pro5xOperation?.status === 'interrupted';
  const memberTab = {
    key: 'members',
    label: <CountedTabLabel label="成员" count={memberRowCount} />,
    children: (
      <ParentMembersTable
        account={account}
        onAccountChanged={onAccountChanged}
      />
    )
  };
  const accountManagerTab = {
    key: 'account-manager',
    label: '账号管理',
    children: (
      <AccountManagerAssociationPanel
        recordLabel="母号"
        recordId={account.id}
        managedAccountEmail={account.managedAccountEmail}
        status={effectiveAccountManagerStatus}
        loading={accountManagerLoading}
        onStatusChanged={onAccountManagerStatusChanged}
        onProfileChanged={onAccountProfileChanged}
      />
    )
  };

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
            <Space size={4} wrap={false} className="detail-capability-tags">
              <Tag color={account.managedAccountEmail ? 'blue' : 'default'}>
                {account.managedAccountEmail ? 'GAM' : '非 GAM'}
              </Tag>
              <WorkspaceOpeningStatusTags
                hasCodexSpace={hasCodexSpace}
                hasTeamSubscription={hasTeamSubscription}
                hasPro5x={hasPro5x}
              />
            </Space>
          </Space>
        </div>
        <Space wrap className="detail-actions">
          <Button
            aria-label="邀请 Workspace 成员"
            icon={<UserAddOutlined />}
            type="primary"
            disabled={!canManageWorkspace}
            onClick={onOpenInvite}
          >
            邀请成员
          </Button>
          {!hasCodexSpace && (
            <Tooltip title={codexButtonTitle}>
              <span>
                <Button
                  icon={<CreditCardOutlined />}
                  loading={accountManagerLoading || codexOpening}
                  disabled={codexButtonDisabled}
                  onClick={onOpenCodexSpace}
                >
                  {codexOpening
                    ? '开通中'
                    : codexWaitingManual
                      ? '等待人工处理'
                      : codexFailed
                        ? '重新开通 0.52'
                        : '开通 0.52'}
                </Button>
              </span>
            </Tooltip>
          )}
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
          <Tooltip title={pro5xButtonTitle}>
            <span>
              <Button
                icon={<CrownOutlined />}
                loading={accountManagerLoading || pro5xOpening}
                disabled={pro5xButtonDisabled}
                onClick={onOpenPro5x}
              >
                {hasPro5x
                  ? openedPro5xButtonLabel(account.accountManagerPro5xCardLast4)
                  : pro5xOpening
                    ? '开通中'
                    : pro5xNeedsCard
                      ? '补充卡片并继续'
                    : pro5xWaitingManual
                      ? '等待人工处理'
                      : pro5xFailed
                        ? '重新开通 Pro 5x'
                        : '开通 Pro 5x'}
              </Button>
            </span>
          </Tooltip>
          <Tooltip title={locallyManaged ? '为个人账号绑定或更新默认信用卡' : '请先关联 GAM 账号'}>
            <span>
              <Button icon={<CreditCardOutlined />} disabled={!locallyManaged || accountManagerLoading}
                onClick={onAddPersonalPaymentMethod}>
                绑定个人支付方式
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

      {pro5xWaitingManual && (
        <Alert
          className="detail-operation-alert"
          type="warning"
          showIcon
          message="Pro 5x 站内付款等待人工处理"
          description={pro5xOperation?.message
            || '在对应 GAM Profile 中核对付款信息并点击 Subscribe；系统会继续监听个人账号套餐状态。'}
          action={pro5xOperation ? (
            <Pro5xOperationActions
              operationId={pro5xOperation.id}
              busyState={busyState}
              onRetryCurrentStep={() => onRetryPro5x(pro5xOperation.id)}
              onRotateIp={() => onRotatePro5x(pro5xOperation.id)}
              onTerminate={() => onTerminatePro5x(pro5xOperation.id)}
            />
          ) : undefined}
        />
      )}

      <Tabs
        activeKey={activeTab}
        onChange={(key) => onTabChange(key as ParentTab)}
        items={canManageWorkspace ? [
          memberTab,
          accountManagerTab,
          {
            key: 'order-maintenance',
            label: '订单维护',
            children: <ParentOrderMaintenancePanel account={account} />
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
        ] : memberRowCount > 0 ? [memberTab, accountManagerTab] : [accountManagerTab]}
      />
    </Card>
  );
}
