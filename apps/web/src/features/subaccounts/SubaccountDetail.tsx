import type {
  AccountSummaryView,
  AccountManagerProfileView,
  CodexQuotaSnapshot,
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
import { WorkspaceOpeningStatusTags } from '../../components/WorkspaceOpeningStatusTags.js';
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
  quota,
  syncing,
  onTabChange,
  onSubaccountChanged,
  onAccountProfileChanged,
  onOpenEdit,
  onOpenDelete,
  onOpenPro5x,
  onTerminatePro5x,
  onDismissPro5x,
  onSync,
  onOpenInvite,
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
  quota: CodexQuotaSnapshot | null;
  syncing: boolean;
  onTabChange: (tab: SubaccountTab) => void;
  onSubaccountChanged: (subaccount: SubaccountView) => void;
  onAccountProfileChanged?: (profile: AccountManagerProfileView) => void;
  onOpenEdit: () => void;
  onOpenDelete: () => void;
  onOpenPro5x: () => void;
  onTerminatePro5x: (operationId: string) => void;
  onDismissPro5x: (operationId: string) => void;
  onSync: () => void;
  onOpenInvite: () => void;
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
  const hasPro5x = accountManagerStatus?.hasPro5x === true;
  const accountManagerUnavailable = accountManagerLoading
    || !accountManagerStatus
    || accountManagerStatus.configured === false
    || accountManagerStatus.reachable === false
    || accountManagerStatus.managed === false;
  const pro5xButtonDisabled = accountManagerUnavailable
    || hasPro5x
    || pro5xOpening
    || (pro5xWaitingManual && !pro5xNeedsCard);
  const pro5xButtonTitle = hasPro5x
    ? '该 GPT 个人账号已开通 Pro 5x'
    : accountManagerStatus?.managed === false
      ? accountManagerStatus.error || '该邮箱未由 GPT Account Manager 管理'
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
                  ? '已开 Pro 5x'
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
                status={accountManagerStatus}
                loading={accountManagerLoading}
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
            label: <CountedTabLabel label="PAT 凭证" count={credentialCount} />,
            children: (
              <SubaccountPatCredentialPanel
                subaccount={subaccount}
                accounts={accounts}
                busyState={busyState}
                quota={quota}
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
