import { Alert, Button, Card, Form, Input, Modal, Select, Space, Statistic, Switch, Table, Tag, Typography, message } from "antd";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { TeamOrderDashboardView, TeamOrderMaintenanceView, TeamUpgradeOrderView, UnifiedAccountSummaryView, WorkspaceSummaryView } from "@team-manager/shared";
import { CHECKOUT_COUNTRY_CODES, CHECKOUT_CURRENCIES } from "@team-manager/shared";
import { unifiedApi } from "../../unifiedApi.js";
import { LoadBoundary, PageHeader, formatTime } from "../../components/ProductPrimitives.js";
import { useUrlPagination } from "../../components/urlPagination.js";

const emptyDashboard: TeamOrderDashboardView = { configured: false, statistics: { maintenanceCount: 0, runningCount: 0, readyCount: 0, attentionCount: 0 }, globalConfiguration: {}, configurations: [], maintenances: [], orders: [] };
const statusColors: Record<string, string> = { ready: "green", running: "blue", queued: "processing", scheduled: "cyan", paused: "default", failed: "red", attention: "orange", expired: "default" };
const orderStatuses = ["all", "scheduled", "queued", "running", "ready", "attention", "paused", "failed", "expired"] as const;

export function TeamOrdersPage() {
  const [params, setParams] = useSearchParams(); const [data, setData] = useState<TeamOrderDashboardView>(emptyDashboard);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummaryView[]>([]); const [accounts, setAccounts] = useState<UnifiedAccountSummaryView[]>([]);
  const [error, setError] = useState(""); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(""); const [, setClock] = useState(0);
  const query = params.get("query") ?? ""; const status = params.get("status") ?? "all"; const editWorkspaceId = params.get("editWorkspace"); const historyWorkspaceId = params.get("historyWorkspace");
  const load = async (background = false) => { if(!background)setLoading(true); setError(""); try { const [next, nextWorkspaces, nextAccounts] = await Promise.all([unifiedApi.teamOrders(), unifiedApi.workspaces(), unifiedApi.accounts(new URLSearchParams("hasManageableWorkspace=true"))]); setData(next); setWorkspaces(nextWorkspaces); setAccounts(nextAccounts); } catch (reason) { setError((reason as Error).message); } finally { if(!background)setLoading(false); } };
  useEffect(() => { void load(); const refresh=window.setInterval(()=>void load(true),15_000);const clock=window.setInterval(()=>setClock(value=>value+1),60_000);return()=>{clearInterval(refresh);clearInterval(clock);}; }, []);
  useEffect(()=>{if(!orderStatuses.includes(status as typeof orderStatuses[number])){const next=new URLSearchParams(params);next.delete("status");setParams(next,{replace:true});}},[params,setParams,status]);
  useEffect(()=>{if(!loading&&editWorkspaceId&&!data.maintenances.some(row=>row.workspaceId===editWorkspaceId))updateParam("editWorkspace");if(!loading&&historyWorkspaceId&&!data.orders.some(row=>row.workspaceId===historyWorkspaceId))updateParam("historyWorkspace");},[data,editWorkspaceId,historyWorkspaceId,loading]);
  const run = async (key: string, action: () => Promise<unknown>) => { setBusy(key); setError(""); try { await action(); await load(); } catch (reason) { setError((reason as Error).message); } finally { setBusy(""); } };
  const updateParam = (key: string, value?: string) => { const next = new URLSearchParams(params); value && value !== "all" ? next.set(key, value) : next.delete(key); setParams(next); };
  const maintenance = useMemo(() => data.maintenances.filter(row => match(row, query) && (status === "all" || row.status === status)), [data.maintenances, query, status]);
  const orders = useMemo(() => data.orders.filter(row => match(row, query) && (status === "all" || row.status === status)), [data.orders, query, status]);
  const edit = data.maintenances.find(row => row.workspaceId === editWorkspaceId); const history = data.orders.filter(row => row.workspaceId === historyWorkspaceId);
  const maintenancePagination=useUrlPagination({total:maintenance.length,pageKey:"maintenancePage",pageSizeKey:"maintenancePageSize"});
  const ordersPagination=useUrlPagination({total:orders.length,pageKey:"ordersPage",pageSizeKey:"ordersPageSize"});
  const historyPagination=useUrlPagination({total:history.length,pageKey:"historyPage",pageSizeKey:"historyPageSize"});

  return <Space direction="vertical" size={16} className="panel-stack">
    <Card><PageHeader title="Team 升级订单" description="按 Workspace 管理执行关系、Checkout 链接和历史订单" actions={<><Button onClick={()=>void load()} loading={loading}>立即刷新</Button><Button disabled={!data.configured} loading={busy === "all"} onClick={() => run("all", () => unifiedApi.runTeamOrders({ all: true, source: "manual_all" }))}>生成全部订单</Button><Button disabled={!data.configured} type="primary" loading={busy === "due"} onClick={() => run("due", () => unifiedApi.runTeamOrders({ source: "manual_maintenance" }))}>运行维护池</Button></>} /></Card>
    {error && <Alert type="error" showIcon message={error} />}
    {!loading&&!data.configured&&<Alert type="warning" showIcon message="TeamCode 服务尚未配置" description="已禁用生成和重试订单；配置 TEAMCODE_BASE_URL 与 TEAMCODE_PASSCODE 后恢复。" />}
    <LoadBoundary loading={loading} error={error} onRetry={load}>
      <div className="team-order-stat-grid"><Card><Statistic title="启用维护" value={data.statistics.maintenanceCount} /></Card><Card><Statistic title="执行中" value={data.statistics.runningCount} /></Card><Card><Statistic title="可结账" value={data.statistics.readyCount} /></Card><Card><Statistic title="需关注" value={data.statistics.attentionCount} valueStyle={data.statistics.attentionCount ? { color: "var(--color-danger)" } : undefined} /></Card></div>
      <Card title="全局订单配置"><ConfigurationForm initial={data.globalConfiguration} busy={busy === "config"} onSave={value => run("config", () => unifiedApi.saveTeamOrderConfiguration(value))} /></Card>
      <Card title="加入维护池"><MaintenanceForm workspaces={workspaces} accounts={accounts} busy={busy === "maintenance"} onSave={value => run("maintenance", () => unifiedApi.saveTeamOrderMaintenance(value.workspaceId, value))} /></Card>
      <Card title="维护状态"><FilterBar query={query} status={status} onQuery={value => updateParam("query", value)} onStatus={value => updateParam("status", value)} />
        <Table rowKey="id" dataSource={maintenance} pagination={maintenancePagination} scroll={{ x: 1450 }} columns={maintenanceColumns(run, busy, updateParam, data.configured)} />
      </Card>
      <Card title="最近订单"><Table rowKey="id" dataSource={orders} pagination={ordersPagination} scroll={{ x: 2050 }} columns={orderColumns(run, busy, updateParam, data.configured)} /></Card>
    </LoadBoundary>
    <Modal title={`编辑维护关系 · ${edit?.workspaceName ?? edit?.workspaceExternalId ?? ""}`} open={Boolean(edit)} footer={null} destroyOnHidden onCancel={() => updateParam("editWorkspace")}>
      {edit && <MaintenanceForm initial={edit} workspaces={workspaces.filter(row => row.id === edit.workspaceId)} accounts={accounts} busy={busy === `edit-${edit.id}`} lockWorkspace onSave={value => run(`edit-${edit.id}`, async () => { await unifiedApi.saveTeamOrderMaintenance(edit.workspaceId, value); updateParam("editWorkspace"); })} />}
    </Modal>
    <Modal title={`Workspace 历史订单（${history.length}）`} open={Boolean(historyWorkspaceId)} width={1000} footer={null} onCancel={() => updateParam("historyWorkspace")}>
      <Table rowKey="id" dataSource={history} pagination={historyPagination} scroll={{ x: 1800 }} columns={orderColumns(run, busy, updateParam, data.configured).filter(column => column.title !== "Workspace")} />
    </Modal>
  </Space>;
}

function FilterBar({ query, status, onQuery, onStatus }: { query: string; status: string; onQuery: (value: string) => void; onStatus: (value: string) => void }) { return <Space wrap className="team-orders-toolbar"><Input.Search allowClear placeholder="Workspace 或执行账号" value={query} onChange={event => onQuery(event.target.value)} /><Select value={status} onChange={onStatus} options={orderStatuses.map(value => ({ value, label: value === "all" ? "全部状态" : value }))} /></Space>; }

function ConfigurationForm({ initial, busy, onSave }: { initial: { workspaceId?: string; workspaceName?: string; promoCode?: string; country?: string; currency?: string }; busy: boolean; onSave: (value: Record<string, unknown>) => void }) { return <Form key={JSON.stringify(initial)} layout="vertical" initialValues={{ country: "US", currency: "USD", ...initial }} onFinish={onSave}><div className="team-order-config-grid"><Form.Item name="promoCode" label="优惠码"><Input allowClear /></Form.Item><Form.Item name="country" label="国家"><Select showSearch options={CHECKOUT_COUNTRY_CODES.map(value => ({ value, label: value }))} /></Form.Item><Form.Item name="currency" label="货币"><Select options={CHECKOUT_CURRENCIES.map(value => ({ value, label: value }))} /></Form.Item><Button htmlType="submit" type="primary" loading={busy}>保存配置</Button></div></Form>; }

function MaintenanceForm({ initial, workspaces, accounts, busy, lockWorkspace, onSave }: { initial?: Partial<TeamOrderMaintenanceView>; workspaces: WorkspaceSummaryView[]; accounts: UnifiedAccountSummaryView[]; busy: boolean; lockWorkspace?: boolean; onSave: (value: any) => void }) { return <Form key={initial?.id ?? "new"} layout="vertical" initialValues={{ workspaceId: initial?.workspaceId, executorAccountId: initial?.executorAccountId, enabled: initial?.enabled ?? true, promoCode: initial?.configuration?.promoCode, country: initial?.configuration?.country, currency: initial?.configuration?.currency }} onFinish={onSave}><div className="team-order-config-grid"><Form.Item name="workspaceId" label="Workspace" rules={[{ required: true }]}><Select showSearch disabled={lockWorkspace} optionFilterProp="label" options={workspaces.map(row => ({ value: row.id, label: row.name ?? row.externalId }))} /></Form.Item><Form.Item name="executorAccountId" label="执行账号" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={accounts.map(row => ({ value: row.id, label: row.email }))} /></Form.Item><Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item></div><ConfigurationFields/><Button htmlType="submit" type="primary" loading={busy}>保存维护关系</Button></Form>; }
function ConfigurationFields() { return <div className="team-order-config-grid"><Form.Item name="promoCode" label="Workspace 优惠码"><Input allowClear /></Form.Item><Form.Item name="country" label="覆盖国家"><Select allowClear showSearch options={CHECKOUT_COUNTRY_CODES.map(value => ({ value, label: value }))} /></Form.Item><Form.Item name="currency" label="覆盖货币"><Select allowClear options={CHECKOUT_CURRENCIES.map(value => ({ value, label: value }))} /></Form.Item></div>; }

function maintenanceColumns(run: (key: string, action: () => Promise<unknown>) => Promise<void>, busy: string, updateParam: (key: string, value?: string) => void, configured: boolean): any[] { return [
  { title: "Workspace", render: (_: unknown, row: TeamOrderMaintenanceView) => <div><Link to={`/workspaces/${row.workspaceId}`}>{row.workspaceName ?? row.workspaceExternalId}</Link><br/><Button type="link" size="small" onClick={() => updateParam("historyWorkspace", row.workspaceId)}>查看历史订单</Button></div> },
  { title: "执行账号", dataIndex: "executorEmail" }, { title: "状态", dataIndex: "status", render: (value: string) => <Tag color={statusColors[value]}>{value}</Tag> },
  { title: "配置", render: (_:unknown,row:TeamOrderMaintenanceView)=>configurationText(row.configuration) }, { title: "下次运行", dataIndex: "nextRunAt", render: formatTime }, { title: "上次运行", dataIndex: "lastRunAt", render: formatTime }, { title: "上次成功", dataIndex: "lastSuccessAt", render: formatTime },
  { title: "异常", render: (_: unknown, row: TeamOrderMaintenanceView) => row.lastError ?? row.pauseReason ?? "—" },
  { title: "操作", fixed: "right", render: (_: unknown, row: TeamOrderMaintenanceView) => <Space wrap><Button size="small" onClick={() => updateParam("editWorkspace", row.workspaceId)}>编辑</Button><Button size="small" disabled={!configured} loading={busy === `run-${row.id}`} onClick={() => run(`run-${row.id}`, () => unifiedApi.runTeamOrders({ workspaceId: row.workspaceId, source: "manual_workspace" }))}>运行</Button><Button size="small" onClick={() => run(`toggle-${row.id}`, () => unifiedApi.controlTeamOrder(row.workspaceId, row.enabled ? "pause" : "resume"))}>{row.enabled ? "暂停" : "恢复"}</Button><Button size="small" danger onClick={() => Modal.confirm({ title: "删除维护关系？", onOk: () => run(`delete-${row.id}`, () => unifiedApi.controlTeamOrder(row.workspaceId, "delete")) })}>删除</Button></Space> },
]; }

function orderColumns(run: (key: string, action: () => Promise<unknown>) => Promise<void>, busy: string, updateParam: (key: string, value?: string) => void, configured: boolean): any[] { return [
  { title: "Workspace", render: (_: unknown, row: TeamUpgradeOrderView) => <Button type="link" onClick={() => updateParam("historyWorkspace", row.workspaceId)}>{row.workspaceName ?? row.workspaceExternalId}</Button> },
  { title: "执行账号", dataIndex: "executorEmail" }, { title: "状态", dataIndex: "status", render: (value: string) => <Tag color={statusColors[value]}>{value}</Tag> },
  { title: "Checkout", render: (_: unknown, row: TeamUpgradeOrderView) => safeHttpUrl(row.checkoutUrl) ? <Space><Button size="small" type="primary" onClick={() => window.open(safeHttpUrl(row.checkoutUrl), "_blank", "noopener,noreferrer")}>打开</Button><Button size="small" onClick={() => void navigator.clipboard.writeText(row.checkoutUrl!).then(() => message.success("Checkout 链接已复制"))}>复制</Button></Space> : row.checkoutUrl?<Tag color="red">无效链接</Tag>:"—" },
  { title: "有效期", render: (_: unknown, row: TeamUpgradeOrderView) => row.expiresAt ? <div>{formatTime(row.expiresAt)}<br/><Typography.Text type="secondary">{remaining(row.expiresAt)}</Typography.Text></div> : "—" },
  { title: "配置", render: (_:unknown,row:TeamUpgradeOrderView)=>configurationText(row.configuration) }, { title: "计划时间", dataIndex:"scheduledFor",render:formatTime }, { title: "重试时间", dataIndex:"retryAt",render:formatTime }, { title: "创建 / 更新", render:(_:unknown,row:TeamUpgradeOrderView)=><>{formatTime(row.createdAt)}<br/><Typography.Text type="secondary">{formatTime(row.updatedAt)}</Typography.Text></> },
  { title: "来源 / 尝试", render: (_: unknown, row: TeamUpgradeOrderView) => `${row.source} / ${row.attemptCount}` }, { title: "错误", dataIndex: "errorMessage", render: (value: string) => value ?? "—" },
  { title: "操作", fixed: "right", render: (_: unknown, row: TeamUpgradeOrderView) => <Space><Button size="small" disabled={!configured} loading={busy === `retry-${row.id}`} onClick={() => run(`retry-${row.id}`, () => unifiedApi.retryTeamOrder(row.id))}>重试</Button><Button size="small" danger onClick={() => Modal.confirm({ title: "删除订单记录？", content: "只删除订单记录，不影响 Workspace。", onOk: () => run(`delete-order-${row.id}`, () => unifiedApi.deleteTeamOrder(row.id)) })}>删除</Button></Space> },
]; }
function match(row: TeamOrderMaintenanceView | TeamUpgradeOrderView, query: string) { const value = query.trim().toLowerCase(); return !value || [row.workspaceName, row.workspaceExternalId, row.executorEmail].some(item => item?.toLowerCase().includes(value)); }
function remaining(value: string) { const milliseconds = new Date(value).getTime() - Date.now(); if (milliseconds <= 0) return "已过期"; const hours = Math.ceil(milliseconds / 3_600_000); return hours > 48 ? `剩余 ${Math.ceil(hours / 24)} 天` : `剩余 ${hours} 小时`; }
function configurationText(value:{promoCode?:string;country?:string;currency?:string}){return [value.country,value.currency,value.promoCode&&`优惠码 ${value.promoCode}`].filter(Boolean).join(" · ")||"—";}
function safeHttpUrl(value?:string){if(!value)return undefined;try{const url=new URL(value);return url.protocol==="https:"||url.protocol==="http:"?url.toString():undefined;}catch{return undefined;}}
