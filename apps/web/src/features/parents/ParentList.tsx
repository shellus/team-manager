import type { AccountView } from '@team-manager/shared';
import { MAX_CHATGPT_SEATS } from '@team-manager/shared';
import { DeleteOutlined, MoreOutlined, ReloadOutlined } from '@ant-design/icons';
import { Button, Card, Dropdown, List, Segmented, Space, Typography } from 'antd';
import { AccountStatusTag, SeatTag } from '../../components/StatusTag.js';
import { formatRelativeTime, shortText } from '../../components/format.js';
import { planLabel, roleLabel } from '../../labels.js';

export function ParentList({
  groups,
  activeGroup,
  accounts,
  selectedId,
  syncingIds,
  onGroupChange,
  onSelect,
  onRefreshAccount,
  onOpenDelete
}: {
  groups: Array<{ name: string; count: number }>;
  activeGroup: string;
  accounts: AccountView[];
  selectedId: string;
  syncingIds: Set<string>;
  onGroupChange: (group: string) => void;
  onSelect: (account: AccountView) => void;
  onRefreshAccount: (account: AccountView) => void;
  onOpenDelete: (account: AccountView) => void;
}) {
  return (
    <div className="side-pane">
      <div className="pane-title">
        <div>
          <Typography.Title level={2}>母号</Typography.Title>
          <Typography.Text type="secondary">{accounts.length} 个 workspace</Typography.Text>
        </div>
      </div>
      {groups.length > 0 && (
        <Segmented
          className="group-selector"
          block
          value={activeGroup}
          options={groups.map((group) => ({
            label: `${group.name} (${group.count})`,
            value: group.name
          }))}
          onChange={(value) => onGroupChange(String(value))}
        />
      )}
      <List
        className="record-list"
        dataSource={accounts}
        locale={{ emptyText: '当前分组没有母号' }}
        renderItem={(account) => {
          const memberCount = account.membersCache?.length;
          const seatCount = account.membersCache?.filter((member) => member.seat === 'default').length;
          const selected = account.id === selectedId;
          const syncing = syncingIds.has(account.id);
          return (
            <List.Item>
              <Card
                className={selected ? 'record-card selected' : 'record-card'}
                size="small"
                hoverable
                onClick={() => onSelect(account)}
              >
                <div className="record-card-head">
                  <div className="record-title">
                    <Typography.Text strong ellipsis={{ tooltip: account.label }}>
                      {account.label}
                    </Typography.Text>
                    <Typography.Text type="secondary" ellipsis={{ tooltip: account.note || account.workspaceName || account.accountId }}>
                      {account.note || account.workspaceName || account.accountId}
                    </Typography.Text>
                  </div>
                  <Space size={4}>
                    <AccountStatusTag status={account.status} />
                    <Dropdown
                      trigger={['click']}
                      menu={{
                        items: [
                          {
                            key: 'refresh',
                            icon: <ReloadOutlined />,
                            label: '同步 Team',
                            onClick: () => onRefreshAccount(account)
                          },
                          {
                            key: 'delete',
                            danger: true,
                            icon: <DeleteOutlined />,
                            label: '删除母号',
                            onClick: () => onOpenDelete(account)
                          }
                        ]
                      }}
                    >
                      <Button
                        aria-label="更多操作"
                        icon={<MoreOutlined />}
                        size="small"
                        type="text"
                        loading={syncing}
                        onClick={(event) => event.stopPropagation()}
                      />
                    </Dropdown>
                  </Space>
                </div>
                <div className="record-meta">
                  <span>{planLabel(account.planType)}</span>
                  <span>{roleLabel(account.role)}</span>
                  <span>成员 {memberCount ?? '暂无'}</span>
                  <span className={seatCount !== undefined && seatCount >= MAX_CHATGPT_SEATS ? 'text-warning' : undefined}>
                    ChatGPT {seatCount ?? '暂无'} / {MAX_CHATGPT_SEATS}
                  </span>
                </div>
                <div className="record-meta muted">
                  <span>分组 {account.groupName || '默认分组'}</span>
                  <span>同步 {formatRelativeTime(account.lastRefreshAt)}</span>
                </div>
                {account.defaultSeat && <SeatTag seat={account.defaultSeat} />}
                {account.lastError && (
                  <Typography.Text className="record-error" type="danger" title={account.lastError}>
                    {shortText(account.lastError, 96)}
                  </Typography.Text>
                )}
              </Card>
            </List.Item>
          );
        }}
      />
    </div>
  );
}
