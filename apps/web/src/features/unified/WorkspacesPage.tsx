import { Alert, Button, Card, Input, Space, Table, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { WorkspaceSummaryView } from '@team-manager/shared';
import { unifiedApi } from '../../unifiedApi.js';
import { LoadBoundary, PageHeader } from '../../components/ProductPrimitives.js';

export function WorkspacesPage() {
  const navigate=useNavigate(); const [params,setParams]=useSearchParams(); const [items,setItems]=useState<WorkspaceSummaryView[]>([]); const [loading,setLoading]=useState(false); const [error,setError]=useState('');
  const load=async()=>{setLoading(true);setError('');try{setItems(await unifiedApi.workspaces(params.get('query')??''));}catch(e){setError((e as Error).message);}finally{setLoading(false);}};useEffect(()=>{void load();},[params.toString()]);
  return <Card><Space direction="vertical" size={16} className="panel-stack"><PageHeader title="Workspaces" description="Team / Business 空间与成员、席位、凭证的独立视图" actions={<><Button onClick={()=>navigate('/overview/workspaces')}>Workspace 总览</Button><Button onClick={()=>navigate('/overview/seats')}>席位总览</Button></>}/>{error&&<Alert type="error" showIcon message={error}/>}<Input.Search allowClear placeholder="名称或外部 ID" value={params.get('query')??''} onChange={(e)=>{const n=new URLSearchParams(params);e.target.value?n.set('query',e.target.value):n.delete('query');setParams(n);}} style={{width:300}}/><LoadBoundary loading={loading} error={error} empty={!items.length} onRetry={load}><Table rowKey="id" dataSource={items} scroll={{x:900}} onRow={r=>({onClick:()=>navigate(`/workspaces/${r.id}`),style:{cursor:'pointer'}})} columns={[{title:'Workspace',render:(_,r)=><div><Typography.Text strong>{r.name??'未命名'}</Typography.Text><br/><Typography.Text type="secondary">{r.externalId}</Typography.Text></div>},{title:'套餐',dataIndex:'plan',render:v=><Tag color="blue">{v}</Tag>},{title:'管理员账号',dataIndex:'manageableAccountCount'},{title:'成员',dataIndex:'memberCount'},{title:'邀请',dataIndex:'invitationCount'},{title:'客户席位',dataIndex:'seatSlotCount'},{title:'凭证',dataIndex:'credentialCount'}]}/></LoadBoundary></Space></Card>;
}
