import type {
  AccountView,
  CodexAuthRuntimeStatus,
  CodexQuotaSnapshot,
  SubaccountAuthLog,
  SubaccountView
} from '@team-manager/shared';
import { Button, Card, Empty, Space, Table, Tabs, Typography } from 'antd';
import { DeleteOutlined, EditOutlined, ReloadOutlined } from '@ant-design/icons';
import type { SubaccountTab } from '../../app/routeState.js';
import { CountedTabLabel } from '../../components/CountedTabLabel.js';
import { formatDateTime } from '../../components/format.js';
import { SubaccountStatusTag } from '../../components/StatusTag.js';
import { SubaccountAuthPanel } from './SubaccountAuthPanel.js';
import { SubaccountCredentialPanel } from './SubaccountCredentialPanel.js';
import { SubaccountTeamLinks } from './SubaccountTeamLinks.js';

export function SubaccountDetail({
  subaccount,
  accounts,
  activeTab,
  runtimeStatus,
  logs,
  busy,
  credentialJson,
  quota,
  runningTarget,
  onTabChange,
  onSubaccountChanged,
  onOpenEdit,
  onOpenDelete,
  onOpenInvite,
  onRefreshRuntime,
  onStartAuth,
  onAutoAuth,
  onRefreshQuota,
  onExportCredential,
  onOpenDeleteCredential
}: {
  subaccount: SubaccountView | null;
  accounts: AccountView[];
  activeTab: SubaccountTab;
  runtimeStatus: CodexAuthRuntimeStatus | null;
  logs: SubaccountAuthLog[];
  busy: string;
  credentialJson: string;
  quota: CodexQuotaSnapshot | null;
  runningTarget: string;
  onTabChange: (tab: SubaccountTab) => void;
  onSubaccountChanged: (subaccount: SubaccountView) => void;
  onOpenEdit: () => void;
  onOpenDelete: () => void;
  onOpenInvite: () => void;
  onRefreshRuntime: () => void;
  onStartAuth: (workspaceId: string, displayName: string) => void;
  onAutoAuth: (workspaceId: string) => void;
  onRefreshQuota: (workspaceId: string) => void;
  onExportCredential: (workspaceId: string) => void;
  onOpenDeleteCredential: (workspaceId: string) => void;
}) {
  if (!subaccount) {
    return (
      <Card className="detail-pane">
        <Empty description="还没有子号" />
      </Card>
    );
  }

  const teamLinkCount = subaccount.teamLinks.length;
  const credentialCount = subaccount.codexCredentials.length;
  const logCount = logs.length;

  return (
    <Card className="detail-pane">
      <div className="detail-header">
        <div>
          <Space align="center">
            <Typography.Title level={2}>{subaccount.label}</Typography.Title>
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
          <Button icon={<ReloadOutlined />} onClick={onRefreshRuntime}>
            检查配置
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
            key: 'credential',
            label: <CountedTabLabel label="凭证" count={credentialCount} />,
            children: (
              <SubaccountCredentialPanel
                subaccount={subaccount}
                accounts={accounts}
                runtimeStatus={runtimeStatus}
                busy={busy}
                credentialJson={credentialJson}
                quota={quota}
                onStartAuth={onStartAuth}
                onAutoAuth={onAutoAuth}
                onRefreshQuota={onRefreshQuota}
                onExportCredential={onExportCredential}
                onOpenDeleteCredential={onOpenDeleteCredential}
              />
            )
          },
          {
            key: 'auth',
            label: '授权',
            children: (
              <SubaccountAuthPanel
                runtimeStatus={runtimeStatus}
                logs={logs}
                runningTarget={runningTarget}
                onRefreshRuntime={onRefreshRuntime}
              />
            )
          },
          {
            key: 'quota',
            label: '额度',
            children: (
              <Table
                rowKey="accountId"
                columns={[
                  { title: 'workspace', dataIndex: 'accountId' },
                  { title: '文件', dataIndex: 'fileName' },
                  { title: '号池', dataIndex: 'groupName' },
                  {
                    title: '最近额度',
                    render: (_, credential) => credential.lastQuota?.status ?? '暂无'
                  },
                  {
                    title: '刷新时间',
                    dataIndex: 'lastQuotaAt',
                    render: (value) => formatDateTime(value)
                  }
                ]}
                dataSource={subaccount.codexCredentials}
                pagination={false}
                locale={{ emptyText: '暂无凭证额度缓存' }}
              />
            )
          },
          {
            key: 'logs',
            label: <CountedTabLabel label="日志" count={logCount} />,
            children: (
              <SubaccountAuthPanel
                runtimeStatus={runtimeStatus}
                logs={logs}
                runningTarget={runningTarget}
                onRefreshRuntime={onRefreshRuntime}
              />
            )
          }
        ]}
      />
    </Card>
  );
}
