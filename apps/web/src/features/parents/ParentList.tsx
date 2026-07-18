import type { AccountView } from '@team-manager/shared';
import { MAX_CHATGPT_SEATS } from '@team-manager/shared';
import { DeleteOutlined, MoreOutlined, ReloadOutlined } from '@ant-design/icons';
import { Button, Card, Dropdown, List, Segmented, Typography } from 'antd';
import { formatRelativeTime, shortText } from '../../components/format.js';
import { KeywordSearchInput } from '../../components/KeywordSearchInput.js';
import { LimitTypeTag } from '../../components/StatusTag.js';
import { ALL_PARENT_GROUP, ALL_PARENT_GROUP_LABEL } from './parentGroups.js';
import {
  parentChatGptSeatUsageCount,
  parentListIdentity,
  parentMemberAndInviteCount,
  parentSeatUsageClass
} from './parentListItem.js';

export function ParentList({
  groups,
  activeGroup,
  accounts,
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
      <KeywordSearchInput
        placeholder="搜索母号邮箱、备注、子号邮箱、子号备注"
        ariaLabel="搜索母号"
        value={searchQuery}
        onSearchChange={onSearchChange}
      />
      {groups.length > 0 && (
        <Segmented
          className="group-selector"
          block
          value={activeGroup}
          options={[
            {
              label: `${ALL_PARENT_GROUP_LABEL} (${groups.reduce((sum, group) => sum + group.count, 0)})`,
              value: ALL_PARENT_GROUP
            },
            ...groups.map((group) => ({
              label: `${group.name} (${group.count})`,
              value: group.name
            }))
          ]}
          onChange={(value) => onGroupChange(String(value))}
        />
      )}
      <List
        className="record-list"
        dataSource={accounts}
        locale={{ emptyText: searchQuery ? '没有匹配的母号' : '当前分组没有母号' }}
        renderItem={(account) => {
          const memberCount = parentMemberAndInviteCount(account);
          const seatCount = parentChatGptSeatUsageCount(account);
          const selected = account.id === selectedId;
          const syncing = syncingIds.has(account.id);
          const title = parentListIdentity(account);
          const workspaceLabel = account.workspaceName || account.accountId;
          const titleTooltip =
            workspaceLabel && workspaceLabel !== account.email ? `${title} · ${workspaceLabel}` : title;
          return (
            <List.Item>
              <Card
                className={selected ? 'record-card selected' : 'record-card'}
                size="small"
                hoverable
                onClick={() => onSelect(account)}
              >
                <div className="record-card-head">
                  <Typography.Text strong ellipsis={{ tooltip: titleTooltip }}>
                    {title}
                  </Typography.Text>
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
                </div>
                <div className="record-meta">
                  <span className={parentSeatUsageClass(seatCount, MAX_CHATGPT_SEATS)}>
                    ChatGPT {seatCount ?? '暂无'} / {MAX_CHATGPT_SEATS}
                  </span>
                  <span>成员/邀请 {memberCount ?? '暂无'}</span>
                  {account.nextRenewalOn && <span>续费 {account.nextRenewalOn}</span>}
                </div>
                <div className="record-meta muted">
                  <span className="record-meta-tag"><LimitTypeTag limitType={account.limitType} /></span>
                  <span>同步 {formatRelativeTime(account.lastRefreshAt)}</span>
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
