import {
  Button,
  Card,
  Empty,
  Input,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type {
  OperationalRiskLevel,
  RenewalOperationalOverviewView,
  RenewalOperationalStatus,
  SeatOperationalOverviewView,
} from "@team-manager/shared";
import { unifiedApi } from "../../unifiedApi.js";
import { LoadBoundary, PageHeader, formatPaymentCardLast4, formatTime } from "../../components/ProductPrimitives.js";
import { formatMoney } from "../../components/OperationalDataPanels.js";
import { limitTypeLabel, seatLabel, statusLabel } from "../../labels.js";
import { useUrlPagination } from "../../components/urlPagination.js";
import { ProductPagination } from "../../components/ProductPagination.js";

const riskMeta: Record<OperationalRiskLevel, { label: string; color: string }> = {
  critical: { label: "严重", color: "red" },
  warning: { label: "关注", color: "orange" },
  normal: { label: "正常", color: "green" },
  unknown: { label: "未知", color: "default" },
};

export const renewalStatusMeta: Record<RenewalOperationalStatus, { label: string; color: string }> = {
  normal: { label: '正常', color: 'green' },
  payment_due: { label: '待支付', color: 'orange' },
  expiring_soon: { label: '三天内到期', color: 'orange' },
  expired: { label: '已到期', color: 'red' },
  seat_over_capacity: { label: '席位超额', color: 'red' },
  renewal_unknown: { label: '续费时间未知', color: 'default' },
  inactive: { label: '未生效', color: 'default' },
};

export function OverviewPage({ kind }: { kind: 'renewals' | 'seats' }) {
  const [params, setParams] = useSearchParams();
  const [renewals, setRenewals] = useState<RenewalOperationalOverviewView[]>([]);
  const [seats, setSeats] = useState<SeatOperationalOverviewView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const query = params.get("query") ?? "";
  const risk = params.get("risk") ?? "all";
  const renewalStatus = params.get("status") ?? "all";
  const seatType = params.get("type") ?? "all";

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      if (kind === "seats") setSeats(await unifiedApi.overviewSeats());
      else setRenewals(await unifiedApi.overviewRenewals());
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [kind]);
  useEffect(() => {
    const next = new URLSearchParams(params);
    let changed = false;
    if (!['all', 'critical', 'warning', 'normal', 'unknown'].includes(risk)) {
      next.delete('risk');
      changed = true;
    }
    if (!['all', 'chatgpt', 'codex'].includes(seatType)) {
      next.delete('type');
      changed = true;
    }
    if (renewalStatus !== 'all' && !(renewalStatus in renewalStatusMeta)) {
      next.delete('status');
      changed = true;
    }
    if (changed) setParams(next, { replace: true });
  }, [params, renewalStatus, risk, seatType, setParams]);

  const updateParam = (key: string, value?: string) => {
    const next = new URLSearchParams(params);
    value && value !== 'all' ? next.set(key, value) : next.delete(key);
    next.delete('page');
    setParams(next);
  };
  const visibleRenewals = useMemo(
    () => renewals.filter((row) => matches(row, query, 'all') && (renewalStatus === 'all' || row.operationalStatus === renewalStatus)),
    [query, renewalStatus, renewals],
  );
  const visibleSeats = useMemo(
    () => seats.filter((row) => matches(row, query, risk) && seatMatches(row, seatType)),
    [query, risk, seatType, seats],
  );

  return (
    <div className="overview-page">
      <PageHeader
        title={kind === 'seats' ? '席位概览' : '母号概览'}
        description={kind === 'seats'
          ? '每张卡片对应一个租客席位，按到期日从早到晚排列'
          : '双席位母号按续费或到期时间从早到晚排列'}
        actions={<Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>刷新数据</Button>}
      />
      <section className="overview-toolbar" aria-label="概览筛选与统计">
        <div className="overview-filters">
          <Input.Search
            allowClear
            placeholder={kind === 'seats' ? '搜索账号、备注、联系或 Workspace' : '搜索账号、备注或 Workspace'}
            value={query}
            onChange={(event) => updateParam('query', event.target.value)}
          />
          {kind === 'seats' ? (
            <Select
              value={risk}
              onChange={(value) => updateParam('risk', value)}
              options={[{ value: 'all', label: '全部风险' }, ...Object.entries(riskMeta).map(([value, meta]) => ({ value, label: meta.label }))]}
            />
          ) : (
            <Select
              value={renewalStatus}
              onChange={(value) => updateParam('status', value)}
              options={[{ value: 'all', label: '全部状态' }, ...Object.entries(renewalStatusMeta).map(([value, meta]) => ({ value, label: meta.label }))]}
            />
          )}
          {kind === 'seats' && (
            <Select
              value={seatType}
              onChange={(value) => updateParam('type', value)}
              options={[
                { value: 'all', label: '全部类型' },
                { value: 'chatgpt', label: 'ChatGPT 席位' },
                { value: 'codex', label: 'Codex 席位' },
              ]}
            />
          )}
        </div>
        {kind === 'seats'
          ? <SeatStats rows={visibleSeats} />
          : <RenewalStats rows={visibleRenewals} />}
      </section>
      <LoadBoundary
        loading={loading}
        error={error}
        empty={kind === 'seats' ? visibleSeats.length === 0 : visibleRenewals.length === 0}
        onRetry={load}
      >
        {kind === 'seats'
          ? <SeatGrid rows={visibleSeats} />
          : <RenewalGrid rows={visibleRenewals} />}
      </LoadBoundary>
    </div>
  );
}

function RenewalStats({ rows }: { rows: RenewalOperationalOverviewView[] }) {
  return <OverviewStats items={[
    ['母号', rows.length],
    ['正常', rows.filter((row) => row.operationalStatus === 'normal').length],
    ['需关注', rows.filter((row) => row.operationalStatus !== 'normal').length],
  ]} />;
}

function SeatStats({ rows }: { rows: SeatOperationalOverviewView[] }) {
  return <OverviewStats items={[
    ['租客席位', rows.length],
    ['ChatGPT', rows.filter((row) => row.seatType === 'default').length],
    ['Codex', rows.filter((row) => row.seatType === 'usage_based').length],
  ]} />;
}

function OverviewStats({ items }: { items: Array<[label: string, value: number]> }) {
  return <div className="overview-stats">{items.map(([label, value]) => (
    <div className="overview-stat" key={label}>
      <Typography.Text strong>{value}</Typography.Text>
      <Typography.Text type="secondary">{label}</Typography.Text>
    </div>
  ))}</div>;
}

function RenewalGrid({ rows }: { rows: RenewalOperationalOverviewView[] }) {
  return (
    <PaginatedGrid
      rows={rows}
      className="renewal-overview-grid"
      storageKey="overview-renewals"
      render={(row) => <RenewalCard key={row.id} item={row} />}
    />
  );
}

function SeatGrid({ rows }: { rows: SeatOperationalOverviewView[] }) {
  return (
    <PaginatedGrid
      rows={rows}
      className="seat-overview-grid"
      storageKey="overview-seats"
      render={(row) => <SeatCard key={row.id} item={row} />}
    />
  );
}

function PaginatedGrid<T extends { id: string }>({
  rows,
  className,
  storageKey,
  render,
}: {
  rows: T[];
  className: string;
  storageKey: string;
  render: (row: T) => ReactNode;
}) {
  const pagination = useUrlPagination({ total: rows.length, pageSizeStorageKey: storageKey, defaultPageSize: 20 });
  const current = Number(pagination.current ?? 1);
  const pageSize = Number(pagination.pageSize ?? 20);
  const pageRows = rows.slice((current - 1) * pageSize, current * pageSize);
  if (pageRows.length === 0) return <Empty description="没有符合条件的卡片" />;
  return (
    <Space direction="vertical" size={16} className="panel-stack">
      <div className={className}>{pageRows.map(render)}</div>
      <ProductPagination pagination={pagination} className="overview-pagination" />
    </Space>
  );
}

function RenewalCard({ item }: { item: RenewalOperationalOverviewView }) {
  const manager = item.managingAccounts[0];
  const target = manager ? `/accounts/${manager.id}?tab=workspaces&workspaceId=${encodeURIComponent(item.workspaceId)}` : undefined;
  const status = renewalStatusMeta[item.operationalStatus];
  return (
    <Card size="small" className={`overview-grid-card risk-${item.riskLevel}`}>
      <div className="parent-overview-head">
        {manager.remark && (target
          ? <Link className="parent-overview-remark" title={manager.remark} to={target}>{manager.remark}</Link>
          : <Typography.Text strong className="parent-overview-remark" title={manager.remark}>{manager.remark}</Typography.Text>)}
        {target
          ? <Link className="parent-overview-account" title={manager.email} to={target}>{manager.email}</Link>
          : <Typography.Text type="secondary" className="parent-overview-account" title={manager.email}>{manager.email}</Typography.Text>}
      </div>
      <div className="overview-fact-grid">
        <OverviewField wide inline emphasis label={item.willRenew === false ? '到期时间' : item.willRenew === true ? '续费时间' : '有效至'}>
          <span className="renewal-primary-fact">
            <span>{item.renewalAt ? formatTime(item.renewalAt) : '未知'}</span>
            <Typography.Text type="secondary">默认支付卡 {formatPaymentCardLast4(item.defaultPaymentCardLast4) ?? '未知'}</Typography.Text>
          </span>
        </OverviewField>
        <OverviewField inline label="预计金额">{formatMoney(item.expectedAmount, item.expectedCurrency)}</OverviewField>
        <OverviewField inline label="席位">{item.fixedSeatCapacity === undefined ? '不适用' : `${item.fixedSeatOccupied ?? 0}/${item.fixedSeatCapacity}，余 ${item.fixedSeatAvailable ?? 0}`}</OverviewField>
        <div className="parent-overview-footer">
          <OverviewField inline label="限额">{limitTypeLabel(manager.limitType)}</OverviewField>
          <Tag color={status.color}>{status.label}</Tag>
        </div>
      </div>
    </Card>
  );
}

function SeatCard({ item }: { item: SeatOperationalOverviewView }) {
  const manager = item.managingAccounts[0];
  const target = manager
    ? `/accounts/${manager.id}?tab=workspaces&workspaceId=${encodeURIComponent(item.workspaceId)}`
    : undefined;
  const identity = item.email ?? '空置租客资料';
  return (
    <Card size="small" className={`overview-grid-card seat-position-card risk-${item.riskLevel}`}>
      <div className="seat-position-head">
        <Typography.Text strong ellipsis={{ tooltip: identity }}>{identity}</Typography.Text>
        <Tag color={item.seatType === 'usage_based' ? 'purple' : 'blue'}>{seatLabel(item.seatType)}</Tag>
      </div>
      <div className="overview-context-line">
        <span title={item.workspaceName ?? item.workspaceExternalId}>{target ? <Link to={target}>{item.workspaceName ?? item.workspaceExternalId}</Link> : item.workspaceName ?? item.workspaceExternalId}</span>
        <Typography.Text type="secondary" title={manager?.email}>{managerSummary(item.managingAccounts)}</Typography.Text>
      </div>
      <div className="overview-fact-grid">
        <OverviewField inline emphasis label="到期">{item.expiresOn ?? '未设置'}</OverviewField>
        <OverviewField inline label="价格">{item.price || '未填写'}</OverviewField>
        {item.contact && <OverviewField wide inline label="联系"><span title={item.contact}>{item.contact}</span></OverviewField>}
        {item.remark && <OverviewField wide inline label="备注"><span title={item.remark}>{item.remark}</span></OverviewField>}
      </div>
      <div className="seat-position-footer">
        <Typography.Text type="secondary">{statusLabel(item.status)}</Typography.Text>
        <RiskTags level={item.riskLevel} risks={item.risks} />
      </div>
    </Card>
  );
}

function OverviewField({ label, children, wide = false, inline = false, emphasis = false }: { label: string; children: ReactNode; wide?: boolean; inline?: boolean; emphasis?: boolean }) {
  return (
    <div className={`overview-fact${wide ? ' is-wide' : ''}${inline ? ' is-inline' : ''}${emphasis ? ' is-emphasis' : ''}`}>
      <Typography.Text type="secondary">{label}</Typography.Text>
      <div className="overview-fact-value">{children}</div>
    </div>
  );
}

function RiskTags({ level, risks }: { level: OperationalRiskLevel; risks: string[] }) {
  if (risks.length === 0) return null;
  const meta = riskMeta[level];
  return (
    <div className="overview-card-risks">
      {risks.map((risk) => <Tag color={meta.color} key={risk}>{risk}</Tag>)}
    </div>
  );
}

function managerSummary(managers: SeatOperationalOverviewView['managingAccounts']): ReactNode {
  if (managers.length === 0) return '无';
  return <>{managers[0].email}{managers.length > 1 && <Typography.Text type="secondary"> +{managers.length - 1}</Typography.Text>}</>;
}

function seatMatches(row: SeatOperationalOverviewView, type: string): boolean {
  if (type === 'chatgpt') return row.seatType === 'default';
  if (type === 'codex') return row.seatType === 'usage_based';
  return true;
}

function matches(
  row: RenewalOperationalOverviewView | SeatOperationalOverviewView,
  query: string,
  risk: string,
): boolean {
  if (risk !== 'all' && row.riskLevel !== risk) return false;
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return searchableValues(row).some((value) => value.toLowerCase().includes(needle));
}

function searchableValues(row: RenewalOperationalOverviewView | SeatOperationalOverviewView): string[] {
  const direct = Object.values(row).filter((value): value is string => typeof value === 'string');
  return [...direct, ...row.managingAccounts.flatMap((manager) => [manager.email, manager.remark ?? ''])];
}
