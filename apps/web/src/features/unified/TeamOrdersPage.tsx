import { useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Input, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import type { UnifiedAccountSummaryView, WorkspaceSummaryView } from '@team-manager/shared';
import { unifiedApi } from '../../unifiedApi.js';

export function TeamOrdersPage() {
  const [data, setData] = useState<any>({ configuration: [], maintenances: [], orders: [] });
  const [workspaces, setWorkspaces] = useState<WorkspaceSummaryView[]>([]);
  const [accounts, setAccounts] = useState<UnifiedAccountSummaryView[]>([]);
  const [error, setError] = useState('');
  const load = async () => {
    try {
      const [next, nextWorkspaces, nextAccounts] = await Promise.all([unifiedApi.teamOrders(), unifiedApi.workspaces(), unifiedApi.accounts(new URLSearchParams('hasManageableWorkspace=true'))]);
      setData(next); setWorkspaces(nextWorkspaces); setAccounts(nextAccounts);
    } catch (e) { setError((e as Error).message); }
  };
  useEffect(() => { void load(); }, []);
  return <Space direction="vertical" size={16} style={{ width: '100%' }}>{error && <Alert type="error" message={error} />}<Card><Typography.Title level={2}>Team 升级订单</Typography.Title><Typography.Paragraph type="secondary">订单维护属于 Workspace，执行账号只是当前策略选择，不构成永久所有权。</Typography.Paragraph>
    <Form layout="inline" initialValues={data.configuration.find((item: any) => !item.workspace_id) ?? { country: 'US', currency: 'USD' }} onFinish={async (value) => { await unifiedApi.saveTeamOrderConfiguration(value); await load(); }}><Form.Item name="promoCode" label="全局优惠码"><Input /></Form.Item><Form.Item name="country" label="国家"><Input maxLength={2} /></Form.Item><Form.Item name="currency" label="货币"><Input maxLength={3} /></Form.Item><Button htmlType="submit" type="primary">保存全局配置</Button></Form>
  </Card><Card title="加入维护池"><Form layout="inline" onFinish={async (value) => { await unifiedApi.saveTeamOrderMaintenance(value.workspaceId, value); await load(); }}><Form.Item name="workspaceId" label="Workspace" rules={[{ required: true }]}><Select style={{ width: 260 }} options={workspaces.map((workspace) => ({ value: workspace.id, label: workspace.name ?? workspace.externalId }))} /></Form.Item><Form.Item name="executorAccountId" label="执行账号" rules={[{ required: true }]}><Select style={{ width: 240 }} options={accounts.map((account) => ({ value: account.id, label: account.email }))} /></Form.Item><Form.Item name="enabled" valuePropName="checked" initialValue><Switch /></Form.Item><Button htmlType="submit">保存维护关系</Button></Form></Card>
    <Card title="维护状态"><Table rowKey="id" dataSource={data.maintenances} columns={[{ title: 'Workspace', render: (_, row: any) => row.workspace_name ?? row.external_id }, { title: '执行账号', dataIndex: 'executor_email' }, { title: '启用', dataIndex: 'enabled', render: (value) => value ? <Tag color="green">是</Tag> : '否' }, { title: '下次运行', dataIndex: 'next_run_at' }, { title: '错误', dataIndex: 'last_error' }]} /></Card>
    <Card title="最近订单"><Table rowKey="id" dataSource={data.orders} columns={[{ title: 'Workspace', render: (_, row: any) => row.workspace_name ?? row.external_id }, { title: '执行账号', dataIndex: 'executor_email' }, { title: '状态', dataIndex: 'status', render: (value) => <Tag>{value}</Tag> }, { title: 'Checkout', dataIndex: 'checkout_url', ellipsis: true }, { title: '错误', dataIndex: 'error_message' }]} /></Card>
  </Space>;
}
