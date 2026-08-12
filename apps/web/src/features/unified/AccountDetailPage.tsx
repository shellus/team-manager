import { useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions, Form, Input, Modal, Select, Space, Table, Tabs, Tag, Typography } from 'antd';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { AccountGroupView, UnifiedAccountDetailView } from '@team-manager/shared';
import { unifiedApi } from '../../unifiedApi.js';
import { SubscriptionModal } from './SubscriptionModal.js';

export function AccountDetailPage() {
  const { accountId } = useParams(); const navigate = useNavigate(); const [params, setParams] = useSearchParams();
  const [account, setAccount] = useState<UnifiedAccountDetailView>(); const [groups, setGroups] = useState<AccountGroupView[]>([]); const [error, setError] = useState('');
  const load = async () => { if (!accountId) return; try { const [a,g] = await Promise.all([unifiedApi.account(accountId), unifiedApi.groups()]); setAccount(a); setGroups(g); } catch (e) { setError((e as Error).message); } };
  useEffect(() => { void load(); }, [accountId]);
  if (!accountId || !account) return <Card loading={!error}>{error && <Alert type="error" message={error} />}</Card>;
  const tab = params.get('tab') ?? 'overview'; const modal = params.get('modal');
  const setUrl = (key: string, value?: string) => { const next = new URLSearchParams(params); value ? next.set(key, value) : next.delete(key); setParams(next); };
  return <Space direction="vertical" size={16} style={{ width: '100%' }}>
    <Card><Space style={{ width: '100%', justifyContent: 'space-between' }} wrap><div><Typography.Text type="secondary">账号</Typography.Text><Typography.Title level={2} style={{ margin: 0 }}>{account.email}</Typography.Title></div><Space><Button onClick={() => setUrl('modal','subscription')}>套餐操作</Button><Button danger onClick={() => Modal.confirm({ title: '删除账号？', content: '有关联关系或历史时数据库会拒绝删除。', onOk: async () => { await unifiedApi.deleteAccount(account.id); navigate('/accounts'); } })}>删除</Button></Space></Space></Card>
    <Card><Tabs activeKey={tab} onChange={(v) => setUrl('tab',v)} items={[
      { key:'overview', label:'概览', children:<Descriptions bordered column={2} items={[{key:'group',label:'分组',children:account.group.name},{key:'plan',label:'个人套餐',children:<Tag color="blue">{account.personalPlan}</Tag>},{key:'gam',label:'GAM',children:account.gamAccountRef ?? '未关联'},{key:'session',label:'Session',children:account.hasSession?'已保存':'无'},{key:'cap',label:'可管理空间',children:account.hasManageableWorkspace?'是':'否'},{key:'credential',label:'凭证',children:account.credentialCount}]} /> },
      { key:'profile', label:'账号设置', children:<Form layout="vertical" initialValues={{ groupId: account.group.id, remark: account.remark, gamAccountRef: account.gamAccountRef }} onFinish={async(v)=>{await unifiedApi.updateAccount(account.id,v); await load();}}><Form.Item name="groupId" label="分组"><Select options={groups.map(g=>({value:g.id,label:g.name}))}/></Form.Item><Form.Item name="remark" label="备注"><Input.TextArea/></Form.Item><Form.Item name="gamAccountRef" label="GAM账号引用"><Input/></Form.Item><Button htmlType="submit" type="primary">保存</Button></Form> },
      { key:'personal', label:'个人空间', children:<Space direction="vertical"><Descriptions bordered items={[{key:'plan',label:'当前套餐',children:account.personalSpace.subscription?.plan ?? account.personalPlan},{key:'renew',label:'自动续费',children:account.personalSpace.subscription?.willRenew === undefined ? '未知' : account.personalSpace.subscription.willRenew?'是':'否'},{key:'ends',label:'结束时间',children:account.personalSpace.subscription?.endsAt ?? '—'}]}/><Space><Button type="primary" onClick={()=>setUrl('modal','subscription')}>开通或变更套餐</Button><Button onClick={async()=>{await unifiedApi.cancelPersonalRenewal(account.id);}}>取消续费</Button></Space></Space> },
      { key:'workspaces', label:`Workspaces (${account.workspaces.length})`, children:<Table rowKey="id" dataSource={account.workspaces} onRow={r=>({onClick:()=>navigate(`/workspaces/${r.id}`),style:{cursor:'pointer'}})} columns={[{title:'名称',render:(_,r)=>r.name??r.externalId},{title:'角色',dataIndex:'role'},{title:'席位',dataIndex:'seatType'},{title:'状态',dataIndex:'membershipStatus'},{title:'管理',dataIndex:'manageable',render:v=>v?<Tag color="green">可管理</Tag>:'—'}]}/> },
      { key:'credentials', label:`凭证 (${account.credentials.length})`, children:<Table rowKey="id" dataSource={account.credentials} columns={[{title:'Workspace',dataIndex:'workspaceId'},{title:'类型',dataIndex:'kind'},{title:'状态',dataIndex:'status'},{title:'哈希',dataIndex:'contentSha256',ellipsis:true}]}/> }
    ]}/></Card>
    <SubscriptionModal accountId={account.id} currentPlan={account.personalPlan} open={modal==='subscription'} onClose={()=>setUrl('modal')} />
  </Space>;
}
