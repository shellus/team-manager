import { Card, Empty, Space, Switch, Tag, Typography } from 'antd';
import type { AccountSeatSlotStatus, AccountView } from '@team-manager/shared';
import { useMemo, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MemberRoleTag, SeatTag } from '../../components/StatusTag.js';
import {
  buildSeatOverviewItems,
  filterSeatOverviewItems,
  seatOverviewBadgeTarget,
  seatOverviewCardIdentity,
  type SeatOverviewItem
} from './seatOverview.js';

const POSITION_STATUS_LABEL: Record<AccountSeatSlotStatus, string> = {
  empty: '空位',
  invited: '邀请中',
  member: '成员',
  unknown: '未确认'
};

const POSITION_STATUS_COLOR: Record<AccountSeatSlotStatus, string | undefined> = {
  empty: undefined,
  invited: 'processing',
  member: 'success',
  unknown: 'warning'
};

export function OverviewPage({
  accounts,
  loading
}: {
  accounts: AccountView[];
  loading: boolean;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const showOwners = searchParams.get('owners') === '1';
  const showCodexSeats = searchParams.get('codex') === '1';
  const allItems = useMemo(() => buildSeatOverviewItems(accounts), [accounts]);
  const items = useMemo(
    () => filterSeatOverviewItems(allItems, { showOwners, showCodexSeats }),
    [allItems, showCodexSeats, showOwners]
  );
  const chatGptCount = items.filter((item) => item.seat === 'default').length;
  const codexCount = items.filter((item) => item.seat === 'usage_based').length;

  const setFilter = (key: 'owners' | 'codex', checked: boolean) => {
    const next = new URLSearchParams(searchParams);
    if (checked) next.set(key, '1');
    else next.delete(key);
    setSearchParams(next);
  };

  return (
    <div className="overview-page">
      <div className="overview-header">
        <div>
          <Typography.Title level={2}>概览</Typography.Title>
          <Typography.Text type="secondary">按到期时间升序列出所有 Team 的成员位置</Typography.Text>
        </div>
        <div className="overview-header-side">
          <Space className="overview-filters" size={16} wrap>
            <label className="overview-switch">
              <Switch checked={showOwners} onChange={(checked) => setFilter('owners', checked)} />
              <Typography.Text>显示所有者</Typography.Text>
            </label>
            <label className="overview-switch">
              <Switch checked={showCodexSeats} onChange={(checked) => setFilter('codex', checked)} />
              <Typography.Text>显示 Codex 席位</Typography.Text>
            </label>
          </Space>
          <Space size={8} wrap>
            <Tag>位置 {items.length}</Tag>
            <Tag color="blue">ChatGPT {chatGptCount}</Tag>
            <Tag color="purple">Codex {codexCount}</Tag>
          </Space>
        </div>
      </div>

      {items.length === 0 ? (
        <Card loading={loading}>
          <Empty description={loading ? '正在加载母号' : allItems.length > 0 ? '当前筛选没有可展示的位置' : '还没有可展示的位置'} />
        </Card>
      ) : (
        <div className="seat-overview-grid">
          {items.map((item) => (
            <SeatOverviewCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function SeatOverviewCard({ item }: { item: SeatOverviewItem }) {
  const identity = seatOverviewCardIdentity(item);
  return (
    <Card className="seat-position-card" size="small">
      <div className="seat-position-head">
        <Typography.Text strong ellipsis={{ tooltip: identity.primary }}>
          {identity.primary}
        </Typography.Text>
        <PositionOrSeatTag item={item} />
      </div>
      <SeatPositionField label="角色">
        <MemberRoleTag role={item.role} />
      </SeatPositionField>
      <SeatPositionField label="Team">
        <Typography.Text ellipsis={{ tooltip: identity.secondary }}>{identity.secondary}</Typography.Text>
      </SeatPositionField>
      <SeatPositionField label="备注">
        <Typography.Text className="seat-position-remark" title={item.remark || defaultRemark(item)}>
          {item.remark || defaultRemark(item)}
        </Typography.Text>
      </SeatPositionField>
      <SeatPositionField label="到期">
        <Typography.Text>
          {item.expiresOn ? `${item.expiresOn}${item.expiresOnSource === 'team-renewal' ? ' · Team续费' : ''}` : '暂无'}
        </Typography.Text>
      </SeatPositionField>
      {(item.price || item.seatKey) && (
        <div className="seat-position-extra">
          {item.price && <Typography.Text type="secondary">价格 {item.price}</Typography.Text>}
          {item.seatKey && (
            <Typography.Text type="secondary" copyable={{ text: item.seatKey }}>
              Seat Key
            </Typography.Text>
          )}
        </div>
      )}
    </Card>
  );
}

function SeatPositionField({
  label,
  children
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="seat-position-field">
      <Typography.Text type="secondary">{label}</Typography.Text>
      <div>{children}</div>
    </div>
  );
}

function PositionStatusTag({ status }: { status: AccountSeatSlotStatus }) {
  return <Tag color={POSITION_STATUS_COLOR[status]}>{POSITION_STATUS_LABEL[status]}</Tag>;
}

function PositionOrSeatTag({ item }: { item: SeatOverviewItem }) {
  const target = seatOverviewBadgeTarget(item);
  return target.kind === 'seat' ? <SeatTag seat={target.seat} /> : <PositionStatusTag status={target.status} />;
}

function defaultRemark(item: SeatOverviewItem): string {
  if (item.source === 'placeholder') return '空 ChatGPT 位置';
  if (item.source === 'member' || item.source === 'invite') return '无本地备注';
  return '无备注';
}
