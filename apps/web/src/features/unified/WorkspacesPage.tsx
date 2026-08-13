import { Alert, Button, Card, Input, Select, Space, Table, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { OperationalRiskLevel, WorkspaceSummaryView } from "@team-manager/shared";
import { unifiedApi } from "../../unifiedApi.js";
import { LoadBoundary, PageHeader, formatTime } from "../../components/ProductPrimitives.js";
import { planLabel, statusLabel } from "../../labels.js";
import { useUrlPagination } from "../../components/urlPagination.js";

const riskLabels: Record<OperationalRiskLevel, { label: string; color: string }> = {
  critical: { label: "严重", color: "red" }, warning: { label: "关注", color: "orange" },
  normal: { label: "正常", color: "green" }, unknown: { label: "未知", color: "default" },
};

export function WorkspacesPage() {
  const navigate = useNavigate(); const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<WorkspaceSummaryView[]>([]); const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  const query = params.get("query") ?? ""; const risk = params.get("risk") ?? "all";
  const load = async () => { setLoading(true); setError(""); try { setItems(await unifiedApi.workspaces(query)); } catch (reason) { setError((reason as Error).message); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, [query]);
  const update = (key: string, value?: string) => { const next = new URLSearchParams(params); value && value !== "all" ? next.set(key, value) : next.delete(key); setParams(next); };
  const visible = useMemo(() => items.filter(item => risk === "all" || (item.riskLevel ?? "unknown") === risk), [items, risk]);
  const pagination = useUrlPagination({ total: visible.length });
  return <Card><Space direction="vertical" size={16} className="panel-stack">
    <PageHeader title="Workspaces" description="Team / Business 空间的运营状态、成员与席位入口" actions={<><Button onClick={() => navigate("/overview/workspaces")}>Workspace 总览</Button><Button onClick={() => navigate("/overview/seats")}>席位总览</Button></>} />
    {error && <Alert type="error" showIcon message={error} />}
    <div className="overview-filters"><Input.Search allowClear placeholder="名称、ID、账号、成员、客户资料或备注" value={query} onChange={event => update("query", event.target.value)} /><Select value={risk} onChange={value => update("risk", value)} options={[{ value: "all", label: "全部风险" }, ...Object.entries(riskLabels).map(([value, meta]) => ({ value, label: meta.label }))]} /></div>
    <LoadBoundary loading={loading} error={error} empty={!visible.length} onRetry={load}><Table rowKey="id" dataSource={visible} pagination={pagination} scroll={{ x: 1200 }} onRow={row => ({ onClick: () => navigate(`/workspaces/${row.id}`), style: { cursor: "pointer" } })} columns={[
      { title: "Workspace", render: (_, row) => <div><Typography.Text strong>{row.name ?? "未命名"}</Typography.Text><br/><Typography.Text type="secondary">{row.externalId}</Typography.Text></div> },
      { title: "套餐", dataIndex: "plan", render: value => <Tag color="blue">{planLabel(value)}</Tag> },
      { title: "状态", dataIndex: "status", render: value => <Tag>{statusLabel(value)}</Tag> },
      { title: "续费时间", dataIndex: "nextRenewalAt", render: formatTime },
      { title: "风险", render: (_, row) => { const meta = riskLabels[row.riskLevel ?? "unknown"]; return <Space wrap size={[4, 4]}><Tag color={meta.color}>{meta.label}</Tag>{row.risks?.map(item => <Tag key={item}>{item}</Tag>)}</Space>; } },
      { title: "管理员账号", dataIndex: "manageableAccountCount" }, { title: "成员", dataIndex: "memberCount" },
      { title: "邀请", dataIndex: "invitationCount" }, { title: "客户席位", dataIndex: "seatSlotCount" }, { title: "凭证", dataIndex: "credentialCount" },
    ]} /></LoadBoundary>
  </Space></Card>;
}
