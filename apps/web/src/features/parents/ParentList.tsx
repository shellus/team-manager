import type { AccountView } from '@team-manager/shared';
import { MAX_CHATGPT_SEATS } from '@team-manager/shared';
import { DeleteOutlined, MoreOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { Button, Card, Dropdown, Input, List, Segmented, Space, Typography } from 'antd';
import { formatRelativeTime, shortText } from '../../components/format.js';
import { limitTypeLabel } from '../../labels.js';

export function ParentList({
  groups,
  activeGroup,
  accounts,
  totalCount,
  searchQuery,
  selectedId,
  syncingIds,
  onGroupChange,
  onSearchChange,
  onSelect,
  onRefreshAccount,
  onOpenDelete
}: {
  groups: Array<{ name: string; count: number }>;
  activeGroup: string;
  accounts: AccountView[];
  totalCount: number;
  searchQuery: string;
  selectedId: string;
  syncingIds: Set<string>;
  onGroupChange: (group: string) => void;
  onSearchChange: (query: string) => void;
  onSelect: (account: AccountView) => void;
  onRefreshAccount: (account: AccountView) => void;
  onOpenDelete: (account: AccountView) => void;
}) {
  return (
    <div className="side-pane">
      <div className="pane-title">
        <div>
          <Typography.Title level={2}>母号</Typography.Title>
          <Typography.Text type="secondary">
            {searchQuery ? `${accounts.length} / ${totalCount} 个 workspace` : `${accounts.length} 个 workspace`}
          </Typography.Text>
        </div>
      </div>
      <Input
        allowClear
        className="pane-search"
        prefix={<SearchOutlined />}
        placeholder="搜索母号邮箱、备注、子号邮箱、子号备注"
        value={searchQuery}
        onChange={(event) => onSearchChange(event.target.value)}
      />
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
        locale={{ emptyText: searchQuery ? '没有匹配的母号' : '当前分组没有母号' }}
        renderItem={(account) => {
          const memberCount = account.membersCache?.length;
          const seatCount = account.membersCache?.filter((member) => member.seat === 'default').length;
          const selected = account.id === selectedId;
          const syncing = syncingIds.has(account.id);
          const note = account.note || account.workspaceName || account.accountId;
          return (
            <List.Item>
              <Card
                className={selected ? 'record-card selected' : 'record-card'}
                size="small"
                hoverable
                onClick={() => onSelect(account)}
              >
                <div className="record-card-head">
                  <Typography.Text strong ellipsis={{ tooltip: note }}>
                    {note}
                  </Typography.Text>
                  <Space size={4}>
                    <Typography.Text type="secondary">同步 {formatRelativeTime(account.lastRefreshAt)}</Typography.Text>
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
                <div className="record-meta record-meta-line">
                  <span>限额 {limitTypeLabel(account.limitType)}</span>
                  <Typography.Text
                    className="record-meta-email"
                    type="secondary"
                    ellipsis={{ tooltip: account.email }}
                  >
                    {account.email}
                  </Typography.Text>
                </div>
                <div className="record-meta">
                  <span>成员 {memberCount ?? '暂无'}</span>
                  <span className={seatCount !== undefined && seatCount >= MAX_CHATGPT_SEATS ? 'text-warning' : undefined}>
                    ChatGPT {seatCount ?? '暂无'} / {MAX_CHATGPT_SEATS}
                  </span>
                </div>
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
