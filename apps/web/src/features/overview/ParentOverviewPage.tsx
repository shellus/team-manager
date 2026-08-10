import { Alert, Card, Empty, Pagination, Space, Switch, Tag, Typography } from 'antd';
import type { ParentOverviewItem, ParentOverviewPageView, ParentOverviewSeatItem } from '@team-manager/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiClient } from '../../api.js';
import { LimitTypeTag, SeatSlotStatusTag } from '../../components/StatusTag.js';
import { formatBillingAmount } from '../parents/billingSummary.js';
import { SensitiveText } from './SensitiveText.js';

export function ParentOverviewPage({ initialOverview }: { initialOverview?: ParentOverviewPageView }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [overview, setOverview] = useState<ParentOverviewPageView | undefined>(initialOverview);
  const [loading, setLoading] = useState(initialOverview === undefined);
  const [error, setError] = useState('');
  const masked = searchParams.get('masked') === '1';
  const requestedPage = positiveInteger(searchParams.get('page')) ?? 1;
  const searchParamsKey = searchParams.toString();

  useEffect(() => {
    if (initialOverview !== undefined) return undefined;
    let cancelled = false;
    setLoading(true);
    void apiClient.listParentOverview({ page: requestedPage })
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
    return () => { cancelled = true; };
  }, [initialOverview, requestedPage, searchParamsKey, setSearchParams]);

  const setMasked = (checked: boolean) => {
    const next = new URLSearchParams(searchParams);
    if (checked) next.set('masked', '1');
    else next.delete('masked');
    setSearchParams(next);
  };

  const setPage = (page: number) => {
    const next = new URLSearchParams(searchParams);
    if (page > 1) next.set('page', String(page));
    else next.delete('page');
    setSearchParams(next);
  };

  const items = overview?.items ?? [];
  return (
    <div className="overview-page">
      <div className="overview-header">
        <div>
          <Typography.Title level={2}>母号概览</Typography.Title>
          <Typography.Text type="secondary">未封号的双席位 Team，按预计扣款时间升序排列</Typography.Text>
        </div>
        <div className="overview-header-side">
          <label className="overview-switch">
            <Switch checked={masked} onChange={setMasked} />
            <Typography.Text>脱敏</Typography.Text>
          </label>
          <Space size={8} wrap>
            {loading && <Tag color="processing">更新中</Tag>}
            <Tag color="blue">Team {overview?.total ?? 0}</Tag>
          </Space>
        </div>
      </div>
      {error && <Alert type="error" showIcon message={error} />}
      {items.length === 0 ? (
        <Card loading={loading && !overview}>
          <Empty description={loading && !overview ? '正在加载母号概览' : '没有符合条件的双席位 Team'} />
        </Card>
      ) : (
        <>
          <div className="parent-overview-grid" aria-busy={loading}>
            {items.map((item) => <ParentOverviewCard key={item.id} item={item} masked={masked} />)}
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

function ParentOverviewCard({ item, masked }: { item: ParentOverviewItem; masked: boolean }) {
  return (
    <Card className="parent-overview-card" size="small">
      <div className="seat-position-head">
        <Typography.Text strong ellipsis={{ tooltip: item.teamName }}>{item.teamName}</Typography.Text>
        <Tag color="blue">双席位</Tag>
      </div>
      <div className="parent-overview-meta">
        <OverviewField label="预计扣款">{item.nextRenewalOn || '暂无'}</OverviewField>
        <OverviewField label="限额类型"><LimitTypeTag limitType={item.limitType} /></OverviewField>
        <OverviewField label="续费金额"><RenewalBillingText billing={item.renewalBilling} /></OverviewField>
        <OverviewField label="母号">
          <SensitiveText masked={masked}>{item.parentEmail}</SensitiveText>
        </OverviewField>
        <OverviewField label="备注">
          <SensitiveText masked={masked && Boolean(item.remark)}>{item.remark || '无备注'}</SensitiveText>
        </OverviewField>
      </div>
      <div className="parent-overview-seats">
        {[0, 1].map((index) => (
          <ParentSeatRow key={item.seats[index]?.seatKey ?? `empty-${index}`} seat={item.seats[index]} index={index} masked={masked} />
        ))}
      </div>
    </Card>
  );
}

function ParentSeatRow({ seat, index, masked }: { seat?: ParentOverviewSeatItem; index: number; masked: boolean }) {
  return (
    <div className="parent-overview-seat">
      <div className="parent-overview-seat-head">
        <Typography.Text type="secondary">席位 {index + 1}</Typography.Text>
        <Typography.Text ellipsis={masked ? true : { tooltip: seat?.email || '空位' }}>
          <SensitiveText masked={masked && Boolean(seat?.email)}>{seat?.email || '空位'}</SensitiveText>
        </Typography.Text>
        <SeatSlotStatusTag status={seat?.status ?? 'empty'} />
      </div>
      <div className="parent-overview-seat-detail">
        <Typography.Text type="secondary">备注</Typography.Text>
        <Typography.Text ellipsis={masked ? true : { tooltip: seat?.remark || '无备注' }}>
          <SensitiveText masked={masked && Boolean(seat?.remark)}>{seat?.remark || '无备注'}</SensitiveText>
        </Typography.Text>
      </div>
      <div className="parent-overview-seat-detail">
        <Typography.Text type="secondary">租金</Typography.Text>
        <Typography.Text ellipsis={{ tooltip: seat?.price || '未填写' }}>{seat?.price || '未填写'}</Typography.Text>
      </div>
    </div>
  );
}

function RenewalBillingText({ billing }: { billing?: ParentOverviewItem['renewalBilling'] }) {
  if (!billing) return <>暂无</>;
  return (
    <span className="parent-overview-renewal-amount">
      <span>{billing.currency} {formatBillingAmount(billing.amount, billing.currency)}</span>
      <span className="parent-overview-renewal-cny">
        {billing.cnyAmount === undefined ? '人民币汇率暂缺' : `约 ${formatBillingAmount(billing.cnyAmount, 'CNY')}`}
      </span>
    </span>
  );
}

function OverviewField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="seat-position-field">
      <Typography.Text type="secondary">{label}</Typography.Text>
      <Typography.Text>{children}</Typography.Text>
    </div>
  );
}

function positiveInteger(value: string | null): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}
