import { useEffect, useState } from 'react';
import { Button, Card, Form, Input, Modal, Select, Space, Switch, Table, Tag, Typography, type TableColumnsType } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import type { AccountGroupView, UnifiedAccountSummaryView } from '@team-manager/shared';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { unifiedApi } from '../../unifiedApi.js';

export function AccountsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [groups, setGroups] = useState<AccountGroupView[]>([]);
  const [accounts, setAccounts] = useState<UnifiedAccountSummaryView[]>([]);
  const [loading, setLoading] = useState(false);
  const modal = params.get('modal');
  const load = async () => {
    setLoading(true);
    try { const [nextGroups, nextAccounts] = await Promise.all([unifiedApi.groups(), unifiedApi.accounts(params)]); setGroups(nextGroups); setAccounts(nextAccounts); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [params.toString()]);
  const set = (key: string, value?: string) => { const next = new URLSearchParams(params); value ? next.set(key, value) : next.delete(key); setParams(next); };
  const columns: TableColumnsType<UnifiedAccountSummaryView> = [
    { title: '账号', render: (_, row) => <div><Typography.Text strong>{row.email}</Typography.Text><br/><Typography.Text type="secondary">{row.displayName ?? row.remark ?? '—'}</Typography.Text></div> },
    { title: '分组', dataIndex: ['group','name'] },
    { title: '套餐', dataIndex: 'personalPlan', render: (v) => <Tag color={v === 'free' ? 'default' : 'blue'}>{v}</Tag> },
    { title: '能力', render: (_, row) => <Space wrap>{row.hasManageableWorkspace && <Tag color="green">可管理空间</Tag>}{row.isWorkspaceMember && <Tag>成员</Tag>}{row.hasWorkspaceCredential && <Tag color="purple">凭证</Tag>}</Space> },
    { title: 'Workspace', dataIndex: 'workspaceCount' }, { title: 'GAM', dataIndex: 'hasGamBinding', render: (v) => v ? '已关联' : '未关联' }
  ];
  return <Card>
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
        <div><Typography.Title level={2} style={{ margin: 0 }}>账号</Typography.Title><Typography.Text type="secondary">个人能力与 Workspace 关系统一从账号进入</Typography.Text></div>
        <Space><Button onClick={() => set('modal', 'groups')}>管理分组</Button><Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/accounts/new')}>添加账号</Button></Space>
      </Space>
      <Space wrap>
        <Input.Search placeholder="邮箱、备注、名称" allowClear defaultValue={params.get('query') ?? ''} onSearch={(v) => set('query', v)} style={{ width: 260 }} />
        <Select allowClear placeholder="账号分组" value={params.get('groupId') ?? undefined} onChange={(v) => set('groupId', v)} options={groups.map((g) => ({ value: g.id, label: `${g.name} (${g.accountCount})` }))} style={{ width: 190 }} />
        <Select allowClear placeholder="个人套餐" value={params.get('personalPlan') ?? undefined} onChange={(v) => set('personalPlan', v)} options={['free','go','plus','pro_5x','pro_20x','unknown'].map((v) => ({ value: v, label: v }))} style={{ width: 160 }} />
        <Space>可管理空间 <Switch checked={params.get('hasManageableWorkspace') === 'true'} onChange={(v) => set('hasManageableWorkspace', v ? 'true' : undefined)} /></Space>
        <Space>GAM <Switch checked={params.get('hasGamBinding') === 'true'} onChange={(v) => set('hasGamBinding', v ? 'true' : undefined)} /></Space>
      </Space>
      <Table<UnifiedAccountSummaryView> rowKey="id" loading={loading} dataSource={accounts} onRow={(row) => ({ onClick: () => navigate(`/accounts/${row.id}`), style: { cursor: 'pointer' } })} columns={columns} />
    </Space>
    <Modal title="账号分组" open={modal === 'groups'} onCancel={() => set('modal')} footer={null}><Space direction="vertical" style={{ width: '100%' }}>
      {groups.map((group) => <Form key={group.id} layout="inline" initialValues={{ name: group.name }} onFinish={async (value) => { await unifiedApi.renameGroup(group.id, value.name); await load(); }}><Form.Item name="name" rules={[{ required: true }]}><Input disabled={group.isDefault} /></Form.Item><Form.Item><Button htmlType="submit" disabled={group.isDefault}>重命名</Button></Form.Item><Button danger disabled={group.isDefault || group.accountCount > 0} onClick={async () => { await unifiedApi.deleteGroup(group.id); await load(); }}>删除</Button><Typography.Text type="secondary">{group.accountCount} 个账号</Typography.Text></Form>)}
      <Form layout="inline" onFinish={async (value) => { await unifiedApi.createGroup(value.name); await load(); }}><Form.Item name="name" rules={[{ required: true }]}><Input placeholder="新分组名称" /></Form.Item><Button htmlType="submit" type="primary">创建</Button></Form>
    </Space></Modal>
  </Card>;
}
