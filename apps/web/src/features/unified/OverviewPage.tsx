import { Alert, Card, Input, Segmented, Select, Space, Table, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { OperationalRiskLevel, SeatOperationalOverviewView, WorkspaceOperationalOverviewView } from "@team-manager/shared";
import { unifiedApi } from "../../unifiedApi.js";
import { LoadBoundary, PageHeader, formatTime } from "../../components/ProductPrimitives.js";

const riskMeta: Record<OperationalRiskLevel, { label: string; color: string }> = {
  critical: { label: "严重", color: "red" }, warning: { label: "关注", color: "orange" },
  normal: { label: "正常", color: "green" }, unknown: { label: "未知", color: "default" },
};
const sourceLabels: Record<SeatOperationalOverviewView["source"], string> = {
  membership: "正式成员", invitation: "待接受邀请", seat_slot: "客户席位", fixed_vacancy: "固定空位",
};

export function OverviewPage() {
  const { kind = "workspaces" } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [workspaces, setWorkspaces] = useState<WorkspaceOperationalOverviewView[]>([]);
  const [seats, setSeats] = useState<SeatOperationalOverviewView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const query = params.get("query") ?? "";
  const risk = params.get("risk") ?? "all";
  const load = async () => {
    setLoading(true); setError("");
    try { if (kind === "seats") setSeats(await unifiedApi.overviewSeats()); else setWorkspaces(await unifiedApi.overviewWorkspaces()); }
    catch (reason) { setError((reason as Error).message); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [kind]);
  const updateParam = (key: string, value?: string) => { const next = new URLSearchParams(params); value && value !== "all" ? next.set(key, value) : next.delete(key); setParams(next); };
  const visibleWorkspaces = useMemo(() => workspaces.filter((row) => matches(row, query, risk)), [workspaces, query, risk]);
  const visibleSeats = useMemo(() => seats.filter((row) => matches(row, query, risk)), [seats, query, risk]);

  return <Space direction="vertical" size={16} className="panel-stack">
    <Card><PageHeader title="运营总览" description="以可操作字段核对 Workspace、席位占用与到期风险" actions={<Segmented value={kind} options={[{ value: "workspaces", label: "Workspace 总览" }, { value: "seats", label: "席位总览" }]} onChange={(value) => navigate(`/overview/${value}`)} />} /></Card>
    {error && <Alert type="error" showIcon message={error} />}
    <Card>
      <div className="overview-filters"><Input.Search allowClear placeholder="搜索 Workspace、账号或备注" value={query} onChange={(event) => updateParam("query", event.target.value)} /><Select value={risk} onChange={(value) => updateParam("risk", value)} options={[{ value: "all", label: "全部风险" }, ...Object.entries(riskMeta).map(([value, meta]) => ({ value, label: meta.label }))]} /></div>
      <LoadBoundary loading={loading} error={error} empty={kind === "seats" ? !visibleSeats.length : !visibleWorkspaces.length} onRetry={load}>
        {kind === "seats" ? <SeatTable rows={visibleSeats} /> : <WorkspaceTable rows={visibleWorkspaces} />}
      </LoadBoundary>
    </Card>
  </Space>;
}

function WorkspaceTable({ rows }: { rows: WorkspaceOperationalOverviewView[] }) {
  return <Table rowKey="id" dataSource={rows} scroll={{ x: 1250 }} columns={[
    { title: "Workspace", render: (_, row) => <div><Link to={`/workspaces/${row.id}`}>{row.name ?? "未命名"}</Link><br/><Typography.Text type="secondary">{row.externalId}</Typography.Text></div> },
    { title: "套餐", dataIndex: "plan", render: value => <Tag color="blue">{value}</Tag> },
    { title: "续费时间", dataIndex: "nextRenewalAt", render: formatTime },
    { title: "预计账单", render: (_, row) => row.expectedAmount ? `${row.expectedCurrency ?? ""} ${row.expectedAmount}`.trim() : "—" },
    { title: "固定席位", render: (_, row) => row.fixedSeatCapacity === undefined ? "—" : `${row.fixedSeatOccupied}/${row.fixedSeatCapacity}（余 ${row.fixedSeatAvailable ?? 0}）` },
    { title: "成员 / 邀请 / 客户席位", render: (_, row) => `${row.memberCount} / ${row.invitationCount} / ${row.seatSlotCount}` },
    { title: "运营风险", render: (_, row) => <RiskCell level={row.riskLevel} risks={row.risks} /> },
  ]} />;
}

function SeatTable({ rows }: { rows: SeatOperationalOverviewView[] }) {
  return <Table rowKey="id" dataSource={rows} scroll={{ x: 1350 }} columns={[
    { title: "Workspace", render: (_, row) => <Link to={`/workspaces/${row.workspaceId}`}>{row.workspaceName ?? row.workspaceExternalId}</Link> },
    { title: "来源", dataIndex: "source", render: value => sourceLabels[value as SeatOperationalOverviewView["source"]] },
    { title: "账号 / 客户", render: (_, row) => <div>{row.email ?? row.displayName ?? "—"}<br/>{row.contact && <Typography.Text type="secondary">{row.contact}</Typography.Text>}</div> },
    { title: "备注", dataIndex: "remark", render: value => value ?? "—" },
    { title: "角色", dataIndex: "role", render: value => value ?? "—" },
    { title: "席位", dataIndex: "seatType", render: value => value === "usage_based" ? "按量" : "固定" },
    { title: "状态", dataIndex: "status", render: value => <Tag>{value}</Tag> },
    { title: "到期日", dataIndex: "expiresOn", render: value => value ?? "—" },
    { title: "价格", dataIndex: "price", render: value => value ?? "—" },
    { title: "运营风险", render: (_, row) => <RiskCell level={row.riskLevel} risks={row.risks} /> },
  ]} />;
}

function RiskCell({ level, risks }: { level: OperationalRiskLevel; risks: string[] }) {
  const meta = riskMeta[level]; return <Space wrap size={[4, 4]}><Tag color={meta.color}>{meta.label}</Tag>{risks.map((risk) => <Tag key={risk}>{risk}</Tag>)}</Space>;
}

function matches(row: WorkspaceOperationalOverviewView | SeatOperationalOverviewView, query: string, risk: string) {
  if (risk !== "all" && row.riskLevel !== risk) return false;
  const needle = query.trim().toLowerCase(); return !needle || Object.values(row).filter(value => typeof value === "string").some(value => value.toLowerCase().includes(needle));
}
