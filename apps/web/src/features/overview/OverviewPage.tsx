import { Alert, Card, Empty, Pagination, Space, Switch, Tag, Typography } from 'antd';
import type {
  AccountOverviewPageView,
  SeatOverviewItem
} from '@team-manager/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiClient } from '../../api.js';
import { MemberRoleTag, SeatSlotStatusTag, SeatTag } from '../../components/StatusTag.js';
import {
  seatOverviewBadgeTarget,
  seatOverviewCardIdentity
} from './seatOverview.js';

export function OverviewPage({ initialOverview }: { initialOverview?: AccountOverviewPageView }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [overview, setOverview] = useState<AccountOverviewPageView | undefined>(initialOverview);
  const [loading, setLoading] = useState(initialOverview === undefined);
  const [error, setError] = useState('');
  const showOwners = searchParams.get('owners') === '1';
  const showCodexSeats = searchParams.get('codex') === '1';
  const requestedPage = positiveInteger(searchParams.get('page')) ?? 1;
  const searchParamsKey = searchParams.toString();
  const items = overview?.items ?? [];

  useEffect(() => {
    if (initialOverview !== undefined) return undefined;
    let cancelled = false;
    setLoading(true);
    void apiClient.listAccountOverview({
      showOwners,
      showCodexSeats,
      page: requestedPage
    })
      .then((next) => {
        if (cancelled) return;
        setOverview(next);
        setError('');
        if (next.page !== requestedPage) {
          const normalized = new URLSearchParams(searchParamsKey);
          if (next.page > 1) normalized.set('page', String(next.page));
          else normalized.delete('page');
          setSearchParams(normalized, { replace: true });
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError((loadError as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initialOverview, requestedPage, searchParamsKey, setSearchParams, showCodexSeats, showOwners]);

  const setFilter = (key: 'owners' | 'codex', checked: boolean) => {
    const next = new URLSearchParams(searchParams);
    if (checked) next.set(key, '1');
    else next.delete(key);
    next.delete('page');
    setSearchParams(next);
  };

  const setPage = (page: number) => {
    const next = new URLSearchParams(searchParams);
    if (page > 1) next.set('page', String(page));
    else next.delete('page');
    setSearchParams(next);
  };

  return (
    <div className="overview-page">
      <div className="overview-header">
        <div>
          <Typography.Title level={2}>概览</Typography.Title>
          <Typography.Text type="secondary">按到期时间升序列出固定 ChatGPT 席位和 Codex 成员位置</Typography.Text>
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
            {loading && <Tag color="processing">更新中</Tag>}
            <Tag>位置 {overview?.total ?? 0}</Tag>
            <Tag color="blue">ChatGPT {overview?.chatGptCount ?? 0}</Tag>
            <Tag color="purple">Codex {overview?.codexCount ?? 0}</Tag>
          </Space>
        </div>
      </div>

      {error && <Alert type="error" showIcon message={error} />}

      {items.length === 0 ? (
        <Card loading={loading && !overview}>
          <Empty description={loading && !overview ? '正在加载概览' : '还没有可展示的位置'} />
        </Card>
      ) : (
        <>
          <div className="seat-overview-grid" aria-busy={loading}>
            {items.map((item) => (
              <SeatOverviewCard key={item.id} item={item} />
            ))}
          </div>
          {overview && overview.total > overview.pageSize && (
            <Pagination
              className="overview-pagination"
              current={overview.page}
              pageSize={overview.pageSize}
              total={overview.total}
              showSizeChanger={false}
              showTotal={(total, range) => `${range[0]}-${range[1]} / ${total}`}
              onChange={setPage}
            />
          )}
        </>
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
        <Space size={4}>
          <PositionOrSeatTag item={item} />
        </Space>
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

function PositionOrSeatTag({ item }: { item: SeatOverviewItem }) {
  const target = seatOverviewBadgeTarget(item);
  return target.kind === 'seat' ? <SeatTag seat={target.seat} /> : <SeatSlotStatusTag status={target.status} />;
}

function defaultRemark(item: SeatOverviewItem): string {
  if (item.source === 'placeholder') return '空 ChatGPT 位置';
  if (item.source === 'member' || item.source === 'invite') return '无本地备注';
  return '无备注';
}

function positiveInteger(value: string | null): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}
