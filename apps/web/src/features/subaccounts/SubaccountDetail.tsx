import type {
  AccountView,
  CodexAuthRuntimeStatus,
  CodexQuotaSnapshot,
  SubaccountAuthLog,
  SubaccountView
} from '@team-manager/shared';
import { Button, Card, Descriptions, Empty, Space, Table, Tabs, Typography } from 'antd';
import { DeleteOutlined, EditOutlined, ReloadOutlined } from '@ant-design/icons';
import type { SubaccountTab } from '../../app/routeState.js';
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
  onStartAuth: (workspaceId: string, label: string) => void;
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

  return (
    <Card className="detail-pane">
      <div className="detail-header">
        <div>
          <Space align="center">
            <Typography.Title level={2}>{subaccount.label}</Typography.Title>
            <SubaccountStatusTag status={subaccount.status} />
          </Space>
          <Typography.Paragraph type="secondary">{subaccount.email}</Typography.Paragraph>
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

      <Descriptions className="summary-descriptions" size="small" column={{ xs: 1, md: 3 }} bordered>
        <Descriptions.Item label="Web Session">{subaccount.hasWebSession ? '已录入' : '未录入'}</Descriptions.Item>
        <Descriptions.Item label="Codex 凭证">{subaccount.codexCredentials.length} 份</Descriptions.Item>
        <Descriptions.Item label="更新">{formatDateTime(subaccount.updatedAt)}</Descriptions.Item>
      </Descriptions>

      <Tabs
        activeKey={activeTab}
        onChange={(key) => onTabChange(key as SubaccountTab)}
        items={[
          {
            key: 'teams',
            label: 'Team 关联',
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
            label: '凭证',
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
            label: '日志',
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
