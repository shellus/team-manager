import { Alert, Card, Checkbox, Input, Segmented, Select, Space, Statistic, Table, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { OperationalRiskLevel, SeatOperationalOverviewView, WorkspaceOperationalOverviewView } from "@team-manager/shared";
import { unifiedApi } from "../../unifiedApi.js";
import { LoadBoundary, PageHeader, formatTime } from "../../components/ProductPrimitives.js";
import { formatMoney } from "../../components/OperationalDataPanels.js";
import { planLabel, roleLabel, statusLabel } from "../../labels.js";
import { useUrlPagination } from "../../components/urlPagination.js";

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
  const seatType = params.get("type") ?? "all";
  const includeOwners = params.get("owners") === "1";
  const load = async () => {
    setLoading(true); setError("");
    try { if (kind === "seats") setSeats(await unifiedApi.overviewSeats()); else setWorkspaces(await unifiedApi.overviewWorkspaces()); }
    catch (reason) { setError((reason as Error).message); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [kind]);
  useEffect(()=>{if(!["workspaces","seats"].includes(kind))navigate("/overview/workspaces",{replace:true});},[kind,navigate]);
  useEffect(()=>{const next=new URLSearchParams(params);let changed=false;if(!["all","critical","warning","normal","unknown"].includes(risk)){next.delete("risk");changed=true;}if(!["all","chatgpt","codex"].includes(seatType)){next.delete("type");changed=true;}if(params.has("owners")&&!(["0","1"].includes(params.get("owners")!))){next.delete("owners");changed=true;}if(changed)setParams(next,{replace:true});},[params,risk,seatType,setParams]);
  const updateParam = (key: string, value?: string) => { const next = new URLSearchParams(params); value && value !== "all" ? next.set(key, value) : next.delete(key); setParams(next); };
  const visibleWorkspaces = useMemo(() => workspaces.filter((row) => matches(row, query, risk)), [workspaces, query, risk]);
  const visibleSeats = useMemo(() => seats.filter((row) => matches(row, query, risk)&&seatMatches(row,seatType,includeOwners)), [seats, query, risk,seatType,includeOwners]);
  const seatStats=useMemo(()=>({total:seats.filter(row=>includeOwners||row.role!=="owner").length,chatgpt:seats.filter(row=>(includeOwners||row.role!=="owner")&&row.seatType==="default").length,codex:seats.filter(row=>(includeOwners||row.role!=="owner")&&row.seatType==="usage_based").length}),[seats,includeOwners]);

  return <Space direction="vertical" size={16} className="panel-stack">
    <Card><PageHeader title="运营总览" description="以可操作字段核对 Workspace、席位占用与到期风险" actions={<Segmented value={kind} options={[{ value: "workspaces", label: "Workspace 总览" }, { value: "seats", label: "席位总览" }]} onChange={(value) => navigate(`/overview/${value}`)} />} /></Card>
    {error && <Alert type="error" showIcon message={error} />}
    <Card>
      <div className="overview-filters"><Input.Search allowClear placeholder="搜索 Workspace、账号或备注" value={query} onChange={(event) => updateParam("query", event.target.value)} /><Select value={risk} onChange={(value) => updateParam("risk", value)} options={[{ value: "all", label: "全部风险" }, ...Object.entries(riskMeta).map(([value, meta]) => ({ value, label: meta.label }))]} />{kind==="seats"&&<><Select value={seatType} onChange={(value) => updateParam("type", value)} options={[{value:"all",label:"全部类型"},{value:"chatgpt",label:"ChatGPT 席位"},{value:"codex",label:"Codex 席位"}]} /><Checkbox checked={includeOwners} onChange={event=>updateParam("owners",event.target.checked?"1":undefined)}>显示所有者</Checkbox></>}</div>
      {kind==="seats"&&<div className="overview-stat-grid"><Statistic title="席位合计" value={seatStats.total}/><Statistic title="ChatGPT" value={seatStats.chatgpt}/><Statistic title="Codex" value={seatStats.codex}/></div>}
      <LoadBoundary loading={loading} error={error} empty={kind === "seats" ? !visibleSeats.length : !visibleWorkspaces.length} onRetry={load}>
        {kind === "seats" ? <SeatTable rows={visibleSeats} /> : <WorkspaceTable rows={visibleWorkspaces} />}
      </LoadBoundary>
    </Card>
  </Space>;
}

function seatMatches(row:SeatOperationalOverviewView,type:string,includeOwners:boolean){if(!includeOwners&&row.role==="owner")return false;if(type==="chatgpt")return row.seatType==="default";if(type==="codex")return row.seatType==="usage_based";return true;}

function WorkspaceTable({ rows }: { rows: WorkspaceOperationalOverviewView[] }) {
  const pagination=useUrlPagination({total:rows.length});
  return <Table rowKey="id" dataSource={rows} pagination={pagination} scroll={{ x: 1250 }} columns={[
    { title: "Workspace", render: (_, row) => <div><Link to={`/workspaces/${row.id}`}>{row.name ?? "未命名"}</Link><br/><Typography.Text type="secondary">{row.externalId}</Typography.Text></div> },
    { title: "套餐", dataIndex: "plan", render: value => <Tag color="blue">{planLabel(value)}</Tag> },
    { title: "续费时间", dataIndex: "nextRenewalAt", render: formatTime },
    { title: "预计账单", render: (_, row) => formatMoney(row.expectedAmount,row.expectedCurrency) },
    { title: "固定席位", render: (_, row) => row.fixedSeatCapacity === undefined ? "—" : `${row.fixedSeatOccupied}/${row.fixedSeatCapacity}（余 ${row.fixedSeatAvailable ?? 0}）` },
    { title: "成员 / 邀请 / 客户席位", render: (_, row) => `${row.memberCount} / ${row.invitationCount} / ${row.seatSlotCount}` },
    { title: "运营风险", render: (_, row) => <RiskCell level={row.riskLevel} risks={row.risks} /> },
  ]} />;
}

function SeatTable({ rows }: { rows: SeatOperationalOverviewView[] }) {
  const pagination=useUrlPagination({total:rows.length});
  return <Table rowKey="id" dataSource={rows} pagination={pagination} scroll={{ x: 1350 }} columns={[
    { title: "Workspace", render: (_, row) => <Link to={`/workspaces/${row.workspaceId}`}>{row.workspaceName ?? row.workspaceExternalId}</Link> },
    { title: "来源", render:(_,row)=>(row.sources??[row.source]).map(value=>sourceLabels[value]).join(" + ") },
    { title: "账号 / 客户", render: (_, row) => <div>{row.email ?? row.displayName ?? "—"}<br/>{row.contact && <Typography.Text type="secondary">{row.contact}</Typography.Text>}</div> },
    { title: "备注", dataIndex: "remark", render: value => value ?? "—" },
    { title: "角色", dataIndex: "role", render: value => value ? roleLabel(value) : "—" },
    { title: "席位", dataIndex: "seatType", render: value => value === "usage_based" ? "按量" : "固定" },
    { title: "状态", dataIndex: "status", render: value => <Tag>{statusLabel(value)}</Tag> },
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
