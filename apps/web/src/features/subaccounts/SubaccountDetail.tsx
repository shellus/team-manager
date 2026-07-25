import type {
  AccountSummaryView,
  CodexQuotaSnapshot,
  SubaccountAuthLog,
  SubaccountView
} from '@team-manager/shared';
import type { ActionBusyState } from '../../components/actionBusy.js';
import { Button, Card, Empty, Space, Tabs, Typography } from 'antd';
import { DeleteOutlined, EditOutlined, ReloadOutlined } from '@ant-design/icons';
import type { SubaccountTab } from '../../app/routeState.js';
import { CountedTabLabel } from '../../components/CountedTabLabel.js';
import { AccountManagerAssociationPanel } from '../../components/AccountManagerAssociationPanel.js';
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
  quota,
  syncing,
  onTabChange,
  onSubaccountChanged,
  onOpenEdit,
  onOpenDelete,
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
  quota: CodexQuotaSnapshot | null;
  syncing: boolean;
  onTabChange: (tab: SubaccountTab) => void;
  onSubaccountChanged: (subaccount: SubaccountView) => void;
  onOpenEdit: () => void;
  onOpenDelete: () => void;
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
          </Space>
        </div>
        <Space wrap>
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
