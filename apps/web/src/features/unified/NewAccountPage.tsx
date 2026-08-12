import { Alert, Button, Card, Form, Input, Select, Space, Switch, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AccountGroupView } from '@team-manager/shared';
import { unifiedApi } from '../../unifiedApi.js';

export function NewAccountPage() {
  const navigate = useNavigate(); const [groups,setGroups]=useState<AccountGroupView[]>([]); const [error,setError]=useState('');
  useEffect(()=>{void unifiedApi.groups().then(setGroups).catch(e=>setError(e.message));},[]);
  return <Card><Typography.Title level={2}>添加账号</Typography.Title><Typography.Paragraph type="secondary">可以先只录入邮箱，也可以同时粘贴 Session、绑定 GAM 引用和代理。</Typography.Paragraph>{error&&<Alert type="error" message={error}/>}<Form layout="vertical" onFinish={async(v)=>{try{const body={...v,session:v.session?JSON.parse(v.session):undefined};const account=await unifiedApi.createAccount(body);navigate(`/accounts/${account.id}`);}catch(e){setError((e as Error).message);}}}>
    <Form.Item name="email" label="邮箱" rules={[{type:'email'}]}><Input/></Form.Item><Form.Item name="groupId" label="分组"><Select options={groups.map(g=>({value:g.id,label:g.name}))}/></Form.Item><Form.Item name="remark" label="备注"><Input/></Form.Item><Form.Item name="gamAccountRef" label="GAM账号引用"><Input/></Form.Item><Form.Item name="proxy" label="账号代理"><Input.Password/></Form.Item><Form.Item name="session" label="ChatGPT Session JSON"><Input.TextArea rows={10}/></Form.Item><Form.Item name="isBanned" label="人工封号" valuePropName="checked"><Switch/></Form.Item><Space><Button onClick={()=>navigate('/accounts')}>取消</Button><Button htmlType="submit" type="primary">创建账号</Button></Space>
  </Form></Card>;
}
