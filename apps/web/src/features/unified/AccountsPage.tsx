import { useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Input, Modal, Select, Space, Table, Tag, Typography, type TableColumnsType } from 'antd';
import { DownOutlined, PlusOutlined, UpOutlined } from '@ant-design/icons';
import type { AccountGroupView, UnifiedAccountSummaryView } from '@team-manager/shared';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { unifiedApi } from '../../unifiedApi.js';
import { LoadBoundary, PageHeader, TriStateSelect } from '../../components/ProductPrimitives.js';

const BOOL_FILTERS = [
  ['hasManageableWorkspace', '可管理空间'], ['isWorkspaceMember', '普通成员'], ['hasWorkspaceCredential', '有凭证'],
  ['hasGamBinding', 'GAM'], ['hasRunningProfile', 'Profile 运行'], ['hasSession', 'Session'], ['isBanned', '人工封号']
] as const;

export function AccountsPage() {
  const navigate = useNavigate(); const [params, setParams] = useSearchParams(); const [groups, setGroups] = useState<AccountGroupView[]>([]); const [accounts, setAccounts] = useState<UnifiedAccountSummaryView[]>([]); const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const modal = params.get('modal');
  const load = async () => { setLoading(true); setError(''); try { const [nextGroups, nextAccounts] = await Promise.all([unifiedApi.groups(), unifiedApi.accounts(params)]); setGroups(nextGroups); setAccounts(nextAccounts); } catch (e) { setError((e as Error).message); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, [params.toString()]);
  const set = (key: string, value?: string) => { const next = new URLSearchParams(params); value ? next.set(key, value) : next.delete(key); setParams(next); };
  const columns: TableColumnsType<UnifiedAccountSummaryView> = [
    { title: '账号', fixed: 'left', width: 250, render: (_, row) => <div><Typography.Text strong>{row.email}</Typography.Text><br/><Typography.Text type="secondary">{row.displayName ?? row.remark ?? '—'}</Typography.Text></div> },
    { title: '分组', dataIndex: ['group','name'], width: 140 }, { title: '套餐', dataIndex: 'personalPlan', width: 110, render: (v) => <Tag color={v === 'free' ? 'default' : 'blue'}>{v}</Tag> },
    { title: '能力', width: 300, render: (_, row) => <Space wrap>{row.hasManageableWorkspace && <Tag color="green">可管理空间</Tag>}{row.isWorkspaceMember && <Tag>普通成员</Tag>}{row.hasWorkspaceCredential && <Tag color="purple">凭证</Tag>}{row.hasSession && <Tag color="cyan">Session</Tag>}{row.isBanned && <Tag color="red">人工封号</Tag>}</Space> },
    { title: 'Workspace', dataIndex: 'workspaceCount', width: 110 }, { title: '凭证', dataIndex: 'credentialCount', width: 80 }, { title: 'GAM', dataIndex: 'hasGamBinding', width: 100, render: (v) => v ? '已关联' : '未关联' }
  ];
  const reorder = async (index: number, delta: number) => { const copy = [...groups]; const target = index + delta; if (target < 0 || target >= copy.length) return; [copy[index], copy[target]] = [copy[target], copy[index]]; await unifiedApi.reorderGroups(copy.map((group) => group.id)); await load(); };
  return <Card className="page-card"><Space direction="vertical" size={16} className="panel-stack">
    <PageHeader title="账号" description="个人能力与 Workspace 关系统一从账号进入" actions={<><Button onClick={() => set('modal', 'groups')}>管理分组</Button><Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/accounts/new')}>添加账号</Button></>} />
    <div className="filter-bar"><Input.Search placeholder="邮箱、备注、名称" allowClear value={params.get('query') ?? ''} onChange={(e) => set('query', e.target.value)} onSearch={(v) => set('query', v)} /><Select allowClear placeholder="账号分组" value={params.get('groupId') ?? undefined} onChange={(v) => set('groupId', v)} options={groups.map((g) => ({ value: g.id, label: `${g.name} (${g.accountCount})` }))}/><Select allowClear placeholder="个人套餐" value={params.get('personalPlan') ?? undefined} onChange={(v) => set('personalPlan', v)} options={['free','go','plus','pro_5x','pro_20x','unknown'].map((v) => ({ value: v, label: v }))}/>{BOOL_FILTERS.map(([key,label]) => <TriStateSelect key={key} placeholder={label} value={params.get(key) ?? undefined} onChange={(v) => set(key, v)} />)}<Button onClick={() => setParams(new URLSearchParams())}>清除筛选</Button></div>
    <LoadBoundary loading={loading} error={error} empty={!accounts.length} onRetry={load}><Table<UnifiedAccountSummaryView> rowKey="id" dataSource={accounts} scroll={{ x: 1200 }} onRow={(row) => ({ onClick: () => navigate(`/accounts/${row.id}`), style: { cursor: 'pointer' } })} columns={columns}/></LoadBoundary>
  </Space><Modal title="账号分组" open={modal === 'groups'} onCancel={() => set('modal')} footer={null} width={700}><Space direction="vertical" className="panel-stack">
    {groups.map((group,index) => <Form key={group.id} className="group-row" initialValues={{ name: group.name }} onFinish={async (value) => { await unifiedApi.renameGroup(group.id, value.name); await load(); }}><Space wrap><Button icon={<UpOutlined/>} disabled={index === 0} onClick={() => void reorder(index,-1)}/><Button icon={<DownOutlined/>} disabled={index === groups.length - 1} onClick={() => void reorder(index,1)}/><Form.Item name="name" rules={[{ required: true }]} noStyle><Input disabled={group.isDefault}/></Form.Item><Button htmlType="submit" disabled={group.isDefault}>重命名</Button><Button danger disabled={group.isDefault || group.accountCount > 0} onClick={async () => { await unifiedApi.deleteGroup(group.id); await load(); }}>删除</Button><Typography.Text type="secondary">{group.accountCount} 个账号</Typography.Text></Space></Form>)}
    <Form layout="inline" onFinish={async (value) => { await unifiedApi.createGroup(value.name); await load(); }}><Form.Item name="name" rules={[{ required: true }]}><Input placeholder="新分组名称" /></Form.Item><Button htmlType="submit" type="primary">创建分组</Button></Form>
  </Space></Modal></Card>;
}
