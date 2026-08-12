import { Card, Input, Space, Table, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { WorkspaceSummaryView } from '@team-manager/shared';
import { unifiedApi } from '../../unifiedApi.js';

export function WorkspacesPage() {
  const navigate=useNavigate(); const [params,setParams]=useSearchParams(); const [items,setItems]=useState<WorkspaceSummaryView[]>([]); const [loading,setLoading]=useState(false);
  useEffect(()=>{setLoading(true);void unifiedApi.workspaces(params.get('query')??'').then(setItems).finally(()=>setLoading(false));},[params.toString()]);
  return <Card><Space direction="vertical" size={16} style={{width:'100%'}}><div><Typography.Title level={2} style={{margin:0}}>Workspaces</Typography.Title><Typography.Text type="secondary">Team / Business 空间与成员、席位、凭证的独立视图</Typography.Text></div><Input.Search allowClear placeholder="名称或外部 ID" defaultValue={params.get('query')??''} onSearch={v=>{const n=new URLSearchParams(params);v?n.set('query',v):n.delete('query');setParams(n);}} style={{width:300}}/><Table rowKey="id" loading={loading} dataSource={items} onRow={r=>({onClick:()=>navigate(`/workspaces/${r.id}`),style:{cursor:'pointer'}})} columns={[{title:'Workspace',render:(_,r)=><div><Typography.Text strong>{r.name??'未命名'}</Typography.Text><br/><Typography.Text type="secondary">{r.externalId}</Typography.Text></div>},{title:'套餐',dataIndex:'plan',render:v=><Tag color="blue">{v}</Tag>},{title:'管理员账号',dataIndex:'manageableAccountCount'},{title:'成员',dataIndex:'memberCount'},{title:'邀请',dataIndex:'invitationCount'},{title:'客户席位',dataIndex:'seatSlotCount'},{title:'凭证',dataIndex:'credentialCount'}]}/></Space></Card>;
}
