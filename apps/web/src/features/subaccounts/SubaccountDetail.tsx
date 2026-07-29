import type {
  AccountSummaryView,
  AccountManagerProfileView,
  CodexQuotaSnapshot,
  Pro5xSubscriptionView,
  SubaccountAccountManagerStatus,
  SubaccountAuthLog,
  SubaccountView
} from '@team-manager/shared';
import { isActionBusy, type ActionBusyState } from '../../components/actionBusy.js';
import { Alert, Button, Card, Empty, Popconfirm, Space, Tabs, Tag, Tooltip, Typography } from 'antd';
import {
  CloseOutlined,
  CrownOutlined,
  DeleteOutlined,
  EditOutlined,
  ReloadOutlined,
  StopOutlined
} from '@ant-design/icons';
import type { SubaccountTab } from '../../app/routeState.js';
import { CountedTabLabel } from '../../components/CountedTabLabel.js';
import { AccountManagerAssociationPanel } from '../../components/AccountManagerAssociationPanel.js';
import { Pro5xOperationActions } from '../../components/Pro5xOperationActions.js';
import { WorkspaceOpeningStatusTags } from '../../components/WorkspaceOpeningStatusTags.js';
import {
  hasManagedAccountReference,
  hasPro5xFromLocalState,
  openedPro5xButtonLabel
} from '../../components/accountManagerLocalState.js';
import { formatDateTime } from '../../components/format.js';
import { BannedStatusTag, SubaccountStatusTag } from '../../components/StatusTag.js';
import { SubaccountLogPanel } from './SubaccountLogPanel.js';
import { SubaccountPatCredentialPanel } from './SubaccountPatCredentialPanel.js';
import { SubaccountSettingsPanel } from './SubaccountSettingsPanel.js';
import { SubaccountTeamLinks } from './SubaccountTeamLinks.js';

export function SubaccountDetail({
  subaccount,
  accounts,
  loading,
  activeTab,
  logs,
  logsLoaded,
  busyState,
  accountManagerStatus,
  accountManagerLoading,
  pro5xSubscription,
  pro5xSubscriptionLoading,
  quota,
  syncing,
  onTabChange,
  onSubaccountChanged,
  onAccountManagerStatusChanged,
  onAccountProfileChanged,
  onOpenEdit,
  onOpenDelete,
  onOpenPro5x,
  onRetryPro5x,
  onRotatePro5x,
  onTerminatePro5x,
  onDismissPro5x,
  onCancelPro5xRenewal,
  onSync,
  onOpenInvite,
  onStartOauth,
  onCreatePat,
  onRefreshQuota,
  onExportPat,
  onOpenDeletePat
}: {
  subaccount: SubaccountView | null;
  accounts: AccountSummaryView[];
  loading: boolean;
  activeTab: SubaccountTab;
  logs: SubaccountAuthLog[];
  logsLoaded: boolean;
  busyState: ActionBusyState;
  accountManagerStatus: SubaccountAccountManagerStatus | null;
  accountManagerLoading: boolean;
  pro5xSubscription: Pro5xSubscriptionView | null;
  pro5xSubscriptionLoading: boolean;
  quota: CodexQuotaSnapshot | null;
  syncing: boolean;
  onTabChange: (tab: SubaccountTab) => void;
  onSubaccountChanged: (subaccount: SubaccountView) => void;
  onAccountManagerStatusChanged?: (status: SubaccountAccountManagerStatus) => void;
  onAccountProfileChanged?: (profile: AccountManagerProfileView) => void;
  onOpenEdit: () => void;
  onOpenDelete: () => void;
  onOpenPro5x: () => void;
  onRetryPro5x: (operationId: string) => void;
  onRotatePro5x: (operationId: string) => void;
  onTerminatePro5x: (operationId: string) => void;
  onDismissPro5x: (operationId: string) => void;
  onCancelPro5xRenewal: () => void;
  onSync: () => void;
  onOpenInvite: () => void;
  onStartOauth: (workspaceId: string, teamTitle: string) => void;
  onCreatePat: (workspaceId: string) => void;
  onRefreshQuota: (workspaceId: string) => void;
  onExportPat: (workspaceId: string) => void;
  onOpenDeletePat: (workspaceId: string) => void;
}) {
  if (loading) return <Card className="detail-pane" loading />;

  if (!subaccount) {
    return (
      <Card className="detail-pane">
        <Empty description="还没有子号" />
      </Card>
    );
  }

  const teamLinkCount = subaccount.teamLinks.length;
  const credentialCount = subaccount.codexCredentials.length;
  const logCount = logsLoaded ? logs.length : undefined;
  const pro5xOperation = accountManagerStatus?.pro5xOperation;
  const pro5xOpening = pro5xOperation?.status === 'queued'
    || pro5xOperation?.status === 'running'
    || pro5xOperation?.status === 'waiting_for_otp';
  const pro5xWaitingManual = pro5xOperation?.status === 'waiting_manual';
  const pro5xNeedsCard = pro5xWaitingManual && pro5xOperation?.phase === 'pro5x_payment_card_required';
  const pro5xFailed = pro5xOperation?.status === 'failed' || pro5xOperation?.status === 'interrupted';
  const hasDirectPro5x = Boolean(
    pro5xSubscription && ['pro', 'prolite'].includes(pro5xSubscription.planType.toLowerCase())
  );
  const hasPro5x = hasPro5xFromLocalState(
    subaccount.accountManagerHasPro5x,
    accountManagerStatus?.hasPro5x
  ) || hasDirectPro5x;
  const locallyManaged = hasManagedAccountReference(subaccount.managedAccountEmail);
  const effectiveAccountManagerStatus = accountManagerStatus
    ? {
        ...accountManagerStatus,
        managed: locallyManaged || accountManagerStatus.managed,
        hasPro5x,
        ...(subaccount.managedAccountEmail
          ? { accountEmail: subaccount.managedAccountEmail }
          : {})
      }
    : accountManagerStatus;
  const pro5xRenewalCancelled = pro5xSubscription?.willRenew === false;
  const pro5xCancellationBusy = isActionBusy(
    busyState,
    `cancel-pro5x-renewal-${subaccount.id}`
  );
  const pro5xAccessUntil = pro5xSubscription?.activeUntil
    ? formatDateTime(pro5xSubscription.activeUntil)
    : '当前计费周期结束';
  const accountManagerUnavailable = !locallyManaged;
  const pro5xButtonDisabled = accountManagerUnavailable
    || hasPro5x
    || pro5xOpening
    || (pro5xWaitingManual && !pro5xNeedsCard);
  const pro5xButtonTitle = hasPro5x
    ? '该 GPT 个人账号已开通 Pro 5x'
    : accountManagerUnavailable
      ? '该子号尚未关联 GPT Account Manager'
      : pro5xWaitingManual
        ? pro5xOperation?.message || '站内付款等待人工处理，系统会继续监听'
        : accountManagerStatus?.error || '使用新加坡指定 ASN 出口开通 Pro 5x';

  return (
    <Card className="detail-pane">
      <div className="detail-header">
        <div>
          <Space align="center">
            <Typography.Title level={2}>{subaccount.remark || subaccount.email}</Typography.Title>
            <BannedStatusTag isBanned={subaccount.isBanned} />
            <SubaccountStatusTag status={subaccount.status} />
          </Space>
          <Space className="detail-meta-row" size={8} wrap>
            <Typography.Text type="secondary">{subaccount.email}</Typography.Text>
            <Typography.Text type="secondary">
              {subaccount.hasWebSession ? 'Web Session 已录入' : 'Web Session 未录入'}
            </Typography.Text>
            <Typography.Text type="secondary">更新 {formatDateTime(subaccount.updatedAt)}</Typography.Text>
            <Tag color={subaccount.managedAccountEmail ? 'blue' : 'default'}>
              {subaccount.managedAccountEmail ? 'GAM' : '非 GAM'}
            </Tag>
            <WorkspaceOpeningStatusTags hasPro5x={hasPro5x} />
          </Space>
        </div>
        <Space wrap>
          <Tooltip title={pro5xButtonTitle}>
            <span>
              <Button
                icon={<CrownOutlined />}
                loading={accountManagerLoading || pro5xOpening}
                disabled={pro5xButtonDisabled}
                onClick={onOpenPro5x}
              >
                {hasPro5x
                  ? openedPro5xButtonLabel(subaccount.accountManagerPro5xCardLast4)
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
          {(hasPro5x || pro5xSubscriptionLoading) && (
            <Popconfirm
              title="取消 Pro 5x 自动续订？"
              description={`仅关闭自动续订，不退款；Pro 权益保留到 ${pro5xAccessUntil}。`}
              okText="确认取消续订"
              okButtonProps={{ danger: true }}
              cancelText="返回"
              disabled={pro5xRenewalCancelled || pro5xSubscriptionLoading}
              onConfirm={onCancelPro5xRenewal}
            >
              <Button
                danger={!pro5xRenewalCancelled}
                icon={<StopOutlined />}
                loading={pro5xSubscriptionLoading || pro5xCancellationBusy}
                disabled={pro5xRenewalCancelled || pro5xSubscriptionLoading}
              >
                {pro5xRenewalCancelled ? '已取消续订' : '取消 Pro 续订'}
              </Button>
            </Popconfirm>
          )}
          <Button icon={<EditOutlined />} onClick={onOpenEdit}>
            本地资料
          </Button>
          <Button icon={<ReloadOutlined />} loading={syncing} onClick={onSync}>
            同步账号
          </Button>
          <Button danger icon={<DeleteOutlined />} onClick={onOpenDelete}>
            删除子号
          </Button>
        </Space>
      </div>

      {pro5xOperation && !hasPro5x && (
        <Alert
          className="detail-operation-alert"
          type={pro5xFailed ? 'error' : pro5xWaitingManual ? 'warning' : 'info'}
          showIcon
          message={pro5xFailed
            ? 'Pro 5x 开通未完成'
            : pro5xWaitingManual
              ? 'Pro 5x 站内付款等待人工处理'
              : '正在开通 Pro 5x'}
          description={pro5xOperation.errorMessage
            || pro5xOperation.message
            || (pro5xWaitingManual
              ? '在对应 GAM Profile 中核对付款信息并点击 Subscribe；系统会继续监听个人账号套餐状态。'
              : 'GPT Account Manager 正在创建站内付款并填写支付信息。')}
          action={pro5xFailed ? (
            <Button
              size="small"
              icon={<CloseOutlined />}
              loading={isActionBusy(busyState, `dismiss-pro5x-${pro5xOperation.id}`)}
              onClick={() => onDismissPro5x(pro5xOperation.id)}
            >
              清除记录
            </Button>
          ) : pro5xWaitingManual ? (
            <Pro5xOperationActions
              operationId={pro5xOperation.id}
              busyState={busyState}
              onRetryCurrentStep={() => onRetryPro5x(pro5xOperation.id)}
              onRotateIp={() => onRotatePro5x(pro5xOperation.id)}
              onTerminate={() => onTerminatePro5x(pro5xOperation.id)}
            />
          ) : (
            <Popconfirm
              title="终止当前 Pro 5x 开通任务？"
              description="终止后会停止关联 Profile，任务不会自动继续。"
              okText="终止任务"
              okButtonProps={{ danger: true }}
              cancelText="取消"
              onConfirm={() => onTerminatePro5x(pro5xOperation.id)}
            >
              <Button
                danger
                size="small"
                icon={<StopOutlined />}
                loading={isActionBusy(busyState, `terminate-pro5x-${pro5xOperation.id}`)}
              >
                终止任务
              </Button>
            </Popconfirm>
          )}
        />
      )}

      {pro5xRenewalCancelled && (
        <Alert
          className="detail-operation-alert"
          type="success"
          showIcon
          message="Pro 5x 自动续订已关闭"
          description={`没有发起退款，当前 Pro 权益保留到 ${pro5xAccessUntil}。`}
        />
      )}

      <Tabs
        activeKey={activeTab}
        onChange={(key) => onTabChange(key as SubaccountTab)}
        items={[
          {
            key: 'teams',
            label: <CountedTabLabel label="Team 关联" count={teamLinkCount} />,
            children: (
              <SubaccountTeamLinks
                subaccount={subaccount}
                accounts={accounts}
                onSubaccountChanged={onSubaccountChanged}
                onOpenInvite={onOpenInvite}
              />
            )
          },
          {
            key: 'account-manager',
            label: '账号管理',
            children: (
              <AccountManagerAssociationPanel
                recordLabel="子号"
                recordId={subaccount.id}
                managedAccountEmail={subaccount.managedAccountEmail}
                status={effectiveAccountManagerStatus}
                loading={accountManagerLoading}
                onStatusChanged={onAccountManagerStatusChanged}
                onProfileChanged={onAccountProfileChanged}
              />
            )
          },
          {
            key: 'settings',
            label: '设置',
            children: (
              <SubaccountSettingsPanel
                subaccount={subaccount}
                onSubaccountChanged={onSubaccountChanged}
              />
            )
          },
          {
            key: 'pat',
            label: <CountedTabLabel label="Codex 凭证" count={credentialCount} />,
            children: (
              <SubaccountPatCredentialPanel
                subaccount={subaccount}
                accounts={accounts}
                busyState={busyState}
                quota={quota}
                onStartOauth={onStartOauth}
                onCreate={onCreatePat}
                onRefreshQuota={onRefreshQuota}
                onExport={onExportPat}
                onOpenDelete={onOpenDeletePat}
              />
            )
          },
          {
            key: 'logs',
            label: <CountedTabLabel label="日志" count={logCount} />,
            children: <SubaccountLogPanel logs={logs} />
          }
        ]}
      />
    </Card>
  );
}
