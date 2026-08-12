import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, Descriptions, Form, Input, InputNumber, Modal, Select, Space, Table, Tabs, Tag, Typography
} from 'antd';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { AccountGroupView, AccountManagerStateView, UnifiedAccountDetailView } from '@team-manager/shared';
import { unifiedApi } from '../../unifiedApi.js';
import { SubscriptionModal } from './SubscriptionModal.js';

export function AccountDetailPage() {
  const { accountId } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [account, setAccount] = useState<UnifiedAccountDetailView>();
  const [manager, setManager] = useState<AccountManagerStateView>();
  const [groups, setGroups] = useState<AccountGroupView[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = async () => {
    if (!accountId) return;
    try {
      const [nextAccount, nextGroups] = await Promise.all([unifiedApi.account(accountId), unifiedApi.groups()]);
      setAccount(nextAccount);
      setGroups(nextGroups);
      if (nextAccount.gamAccountRef) setManager(await unifiedApi.accountManagerState(accountId));
      else setManager(undefined);
    } catch (e) { setError((e as Error).message); }
  };
  useEffect(() => { void load(); }, [accountId]);

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key); setError('');
    try { await action(); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  };
  if (!accountId || !account) return <Card loading={!error}>{error && <Alert type="error" message={error} />}</Card>;

  const tab = params.get('tab') ?? 'overview';
  const modal = params.get('modal');
  const setUrl = (key: string, value?: string) => {
    const next = new URLSearchParams(params); value ? next.set(key, value) : next.delete(key); setParams(next);
  };
  const operations = mergeOperations(account.operations, manager?.operations ?? []);

  return <Space direction="vertical" size={16} style={{ width: '100%' }}>
    {error && <Alert type="error" showIcon closable message={error} onClose={() => setError('')} />}
    <Card><Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
      <div><Typography.Text type="secondary">账号</Typography.Text><Typography.Title level={2} style={{ margin: 0 }}>{account.email}</Typography.Title></div>
      <Space><Button onClick={() => setUrl('modal', 'subscription')}>套餐操作</Button><Button danger onClick={() => Modal.confirm({ title: '删除账号？', content: '有关联关系或历史时数据库会拒绝删除。', onOk: async () => { await unifiedApi.deleteAccount(account.id); navigate('/accounts'); } })}>删除</Button></Space>
    </Space></Card>
    <Card><Tabs activeKey={tab} onChange={(value) => setUrl('tab', value)} items={[
      { key: 'overview', label: '概览', children: <Descriptions bordered column={2} items={[
        { key: 'group', label: '分组', children: account.group.name },
        { key: 'plan', label: '个人套餐', children: <Tag color="blue">{account.personalPlan}</Tag> },
        { key: 'gam', label: 'GAM', children: account.gamAccountRef ?? '未关联' },
        { key: 'session', label: 'Session', children: account.hasSession ? '已保存' : '无' },
        { key: 'cap', label: '可管理空间', children: account.hasManageableWorkspace ? '是' : '否' },
        { key: 'credential', label: '凭证', children: account.credentialCount }
      ]} /> },
      { key: 'management', label: '账号管理', children: <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {!account.gamAccountRef && <Alert type="warning" showIcon message="请先在账号设置中绑定 GAM 账号引用" />}
        <Space wrap>
          <Button disabled={!account.gamAccountRef} loading={busy === 'sync'} onClick={() => run('sync', () => unifiedApi.syncAccountManager(account.id))}>同步 GAM</Button>
          <Button disabled={!account.gamAccountRef} loading={busy === 'start'} onClick={() => run('start', () => unifiedApi.startProfile(account.id))}>启动 Profile</Button>
          <Button disabled={!account.gamAccountRef} loading={busy === 'stop'} onClick={() => run('stop', () => unifiedApi.stopProfile(account.id))}>停止 Profile</Button>
          <Button disabled={!account.gamAccountRef} loading={busy === 'session'} onClick={() => run('session', () => unifiedApi.importGamSession(account.id))}>从 GAM 更新 Session</Button>
        </Space>
        <Descriptions bordered items={[
          { key: 'profile', label: 'Profile', children: manager?.profile?.status ?? '未知' },
          { key: 'profileId', label: 'Profile ID', children: manager?.profile?.profileId ?? '—' },
          { key: 'proxy', label: '住宅代理', children: manager?.proxy ? `${manager.proxy.country} / ${manager.proxy.sid}` : '未读取' },
          { key: 'session', label: '本地 Session', children: account.hasSession ? '可用' : '无' }
        ]} />
        <Form layout="inline" initialValues={manager?.proxy} onFinish={(value) => run('proxy', () => unifiedApi.configureProxy(account.id, {
          sid: value.sid, country: value.country, asn: value.asn || null, state: value.state || null, city: value.city || null
        }))}>
          <Form.Item name="sid" label="代理 SID" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="country" label="国家" rules={[{ required: true }]}><Input maxLength={2} /></Form.Item>
          <Form.Item name="asn" label="ASN"><Input /></Form.Item>
          <Form.Item><Button htmlType="submit" loading={busy === 'proxy'} disabled={!account.gamAccountRef}>保存 GAM 代理</Button></Form.Item>
        </Form>
      </Space> },
      { key: 'settings', label: '账号设置', children: <Form layout="vertical" initialValues={{ groupId: account.group.id, remark: account.remark, gamAccountRef: account.gamAccountRef, isBanned: account.isBanned }} onFinish={async (value) => { await run('settings', () => unifiedApi.updateAccount(account.id, value)); }}>
        <Form.Item name="groupId" label="分组"><Select options={groups.map((group) => ({ value: group.id, label: group.name }))} /></Form.Item>
        <Form.Item name="remark" label="备注"><Input.TextArea /></Form.Item>
        <Form.Item name="gamAccountRef" label="GAM 账号引用"><Input /></Form.Item>
        <Button htmlType="submit" type="primary" loading={busy === 'settings'}>保存</Button>
      </Form> },
      { key: 'personal', label: '个人空间', children: <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Descriptions bordered items={[
          { key: 'plan', label: '当前套餐', children: account.personalSpace.subscription?.plan ?? account.personalPlan },
          { key: 'renew', label: '自动续费', children: account.personalSpace.subscription?.willRenew === undefined ? '未知' : account.personalSpace.subscription.willRenew ? '是' : '否' },
          { key: 'ends', label: '结束时间', children: account.personalSpace.subscription?.endsAt ?? '—' }
        ]} />
        <Space><Button type="primary" onClick={() => setUrl('modal', 'subscription')}>开通或变更套餐</Button><Button onClick={() => run('cancel', () => unifiedApi.cancelPersonalRenewal(account.id))}>取消续费</Button><Button onClick={() => setUrl('modal', 'payment')}>绑定支付方式</Button></Space>
        <Table rowKey="id" pagination={false} dataSource={account.paymentMethods} columns={[
          { title: '品牌', dataIndex: 'brand' }, { title: '尾号', dataIndex: 'last4' },
          { title: '到期', render: (_, row) => row.expMonth && row.expYear ? `${row.expMonth}/${row.expYear}` : '—' },
          { title: '默认', dataIndex: 'isDefault', render: (value) => value ? <Tag color="green">是</Tag> : '否' }
        ]} />
      </Space> },
      { key: 'workspaces', label: `Workspaces (${account.workspaces.length})`, children: <Table rowKey="id" dataSource={account.workspaces} onRow={(row) => ({ onClick: () => navigate(`/workspaces/${row.id}`), style: { cursor: 'pointer' } })} columns={[
        { title: '名称', render: (_, row) => row.name ?? row.externalId }, { title: '角色', dataIndex: 'role' },
        { title: '席位', dataIndex: 'seatType' }, { title: '状态', dataIndex: 'membershipStatus' },
        { title: '管理', dataIndex: 'manageable', render: (value) => value ? <Tag color="green">可管理</Tag> : '—' }
      ]} /> },
      { key: 'credentials', label: `凭证 (${account.credentials.length})`, children: <Space direction="vertical" style={{ width: '100%' }}><Form layout="inline" onFinish={(value) => run('pat', async () => { await unifiedApi.createPatCredential(account.id, value.workspaceId, value); })}><Form.Item name="workspaceId" label="目标 Workspace" rules={[{ required: true }]}><Select style={{ width: 280 }} options={account.workspaces.map((workspace) => ({ value: workspace.id, label: workspace.name ?? workspace.externalId }))} /></Form.Item><Form.Item name="poolGroup" label="凭证号池"><Input /></Form.Item><Form.Item name="name" label="PAT 名称"><Input /></Form.Item><Button htmlType="submit" loading={busy === 'pat'}>创建 PAT</Button></Form><Table rowKey="id" dataSource={account.credentials} columns={[
        { title: 'Workspace', dataIndex: 'workspaceId' }, { title: '类型', dataIndex: 'kind' }, { title: '状态', dataIndex: 'status' }, { title: '额度', render: (_, row) => row.latestQuota ? `${row.latestQuota.status} · ${row.latestQuota.windows.map((window) => `${window.label} ${window.usedPercent ?? '?'}%`).join(' / ')}` : '未刷新' }, { title: '操作', render: (_, row) => <Button size="small" onClick={() => run(`quota-${row.id}`, () => unifiedApi.refreshCredentialQuota(row.id))} loading={busy === `quota-${row.id}`}>刷新额度</Button> }
      ]} /></Space> },
      { key: 'operations', label: `操作记录 (${operations.length})`, children: <Table rowKey="id" dataSource={operations} columns={[
        { title: '时间', dataIndex: 'updatedAt', render: (value) => new Date(value).toLocaleString() }, { title: '类型', dataIndex: 'type' },
        { title: '状态', dataIndex: 'status', render: (value) => <Tag>{value}</Tag> }, { title: '阶段', dataIndex: 'phase' },
        { title: '错误', dataIndex: 'errorMessage' }
      ]} /> }
    ]} /></Card>
    <SubscriptionModal accountId={account.id} currentPlan={account.personalPlan} open={modal === 'subscription'} onClose={() => { setUrl('modal'); void load(); }} />
    <PaymentMethodModal open={modal === 'payment'} busy={busy === 'payment'} onClose={() => setUrl('modal')} onSubmit={(value) => run('payment', async () => { await unifiedApi.addPaymentMethod(account.id, value); setUrl('modal'); })} />
  </Space>;
}

function PaymentMethodModal({ open, busy, onClose, onSubmit }: { open: boolean; busy: boolean; onClose: () => void; onSubmit: (value: any) => Promise<void> }) {
  return <Modal title="绑定个人支付方式" open={open} onCancel={onClose} footer={null} destroyOnClose><Alert type="info" showIcon message="完整卡号和 CVC 只在本次请求中转交 GAM，不写入 Team Manager 数据库。" /><Form layout="vertical" initialValues={{ country: 'US', currency: 'USD' }} onFinish={(value) => onSubmit({ country: value.country.toUpperCase(), currency: value.currency.toUpperCase(), card: { number: value.number, expiryMonth: value.expiryMonth, expiryYear: value.expiryYear, cvc: value.cvc } })} style={{ marginTop: 16 }}>
    <Space><Form.Item name="country" label="国家" rules={[{ required: true }]}><Input maxLength={2} /></Form.Item><Form.Item name="currency" label="货币" rules={[{ required: true }]}><Input maxLength={3} /></Form.Item></Space>
    <Form.Item name="number" label="卡号" rules={[{ required: true }]}><Input inputMode="numeric" autoComplete="cc-number" /></Form.Item>
    <Space><Form.Item name="expiryMonth" label="月" rules={[{ required: true }]}><InputNumber min={1} max={12} /></Form.Item><Form.Item name="expiryYear" label="年" rules={[{ required: true }]}><InputNumber min={2026} max={2100} /></Form.Item><Form.Item name="cvc" label="CVC" rules={[{ required: true }]}><Input.Password maxLength={4} /></Form.Item></Space>
    <Button type="primary" htmlType="submit" loading={busy}>提交给 GAM</Button>
  </Form></Modal>;
}

function mergeOperations<T extends { id: string; updatedAt: number }>(local: T[], remote: T[]): T[] {
  const values = new Map(remote.map((item) => [item.id, item]));
  for (const item of local) if (!values.has(item.id)) values.set(item.id, item);
  return [...values.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}
