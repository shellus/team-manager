import type { AccountView } from '@team-manager/shared';
import { Button, Card, Empty, Space, Tabs, Typography } from 'antd';
import { DeleteOutlined, EditOutlined, ReloadOutlined, UserAddOutlined } from '@ant-design/icons';
import type { ParentTab } from '../../app/routeState.js';
import { CountedTabLabel } from '../../components/CountedTabLabel.js';
import { AccountStatusTag, SeatTag } from '../../components/StatusTag.js';
import { formatRelativeTime } from '../../components/format.js';
import { ParentInvitesTable } from './ParentInvitesTable.js';
import { ParentMembersTable, type MemberSeatRisk } from './ParentMembersTable.js';
import { ParentSettingsPanel } from './ParentSettingsPanel.js';

export function ParentDetail({
  account,
  activeTab,
  syncing,
  onTabChange,
  onSync,
  onOpenInvite,
  onOpenDelete,
  onOpenLocalProfile,
  onAccountChanged,
  onBillingRisk
}: {
  account: AccountView | null;
  activeTab: ParentTab;
  syncing: boolean;
  onTabChange: (tab: ParentTab) => void;
  onSync: () => void;
  onOpenInvite: () => void;
  onOpenDelete: () => void;
  onOpenLocalProfile: () => void;
  onAccountChanged: (account: AccountView) => void;
  onBillingRisk: (risk: MemberSeatRisk) => void;
}) {
  if (!account) {
    return (
      <Card className="detail-pane">
        <Empty description="还没有母号" />
      </Card>
    );
  }

  const memberCount = account.membersCache?.length;
  const inviteCount = account.pendingInvitesCache?.length;

  return (
    <Card className="detail-pane">
      <div className="detail-header">
        <div>
          <Space align="center">
            <Typography.Title level={2}>{account.email}</Typography.Title>
            <AccountStatusTag status={account.status} />
          </Space>
          <Space className="detail-meta-row" size={8} wrap>
            <Typography.Text type="secondary">
              {account.note ? `${account.note} · ${account.workspaceName || account.accountId}` : account.workspaceName || account.accountId}
            </Typography.Text>
            <Typography.Text type="secondary">默认席位</Typography.Text>
            <SeatTag seat={account.defaultSeat} />
          </Space>
        </div>
        <Space wrap>
          <Typography.Text type="secondary">同步 {formatRelativeTime(account.lastRefreshAt)}</Typography.Text>
          <Button icon={<UserAddOutlined />} type="primary" onClick={onOpenInvite}>
            邀请成员
          </Button>
          <Button icon={<EditOutlined />} onClick={onOpenLocalProfile}>
            本地资料
          </Button>
          <Button icon={<ReloadOutlined />} loading={syncing} onClick={onSync}>
            同步 Team
          </Button>
          <Button danger icon={<DeleteOutlined />} onClick={onOpenDelete}>
            删除母号
          </Button>
        </Space>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={(key) => onTabChange(key as ParentTab)}
        items={[
          {
            key: 'members',
            label: <CountedTabLabel label="成员" count={memberCount} />,
            children: (
              <ParentMembersTable
                account={account}
                onAccountChanged={onAccountChanged}
                onBillingRisk={onBillingRisk}
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
            key: 'settings',
            label: '设置',
            children: (
              <ParentSettingsPanel
                account={account}
                onAccountChanged={onAccountChanged}
                onOpenLocalProfile={onOpenLocalProfile}
              />
            )
          }
        ]}
      />
    </Card>
  );
}
