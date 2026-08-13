import { Alert, Button, Card, Divider, Form, Input, Select, Space, Switch, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AccountGroupView } from '@team-manager/shared';
import { unifiedApi } from '../../unifiedApi.js';

export function NewAccountPage() {
  const navigate = useNavigate(); const [groups,setGroups]=useState<AccountGroupView[]>([]); const [error,setError]=useState('');
  useEffect(()=>{void unifiedApi.groups().then(setGroups).catch(e=>setError(e.message));},[]);
  return <Card><Typography.Title level={2}>添加账号</Typography.Title><Typography.Paragraph type="secondary">手工录入已有账号，或让 GAM 注册一个新账号。两者最终都会成为同一种账号。</Typography.Paragraph>{error&&<Alert type="error" showIcon message={error}/>}<Form layout="vertical" onFinish={async(v)=>{setError('');try{const body={...v,session:v.session?JSON.parse(v.session):undefined};const account=await unifiedApi.createAccount(body);navigate(`/accounts/${account.id}`);}catch(e){setError((e as Error).message);}}}>
    <Form.Item name="email" label="邮箱" rules={[{type:'email'}]}><Input/></Form.Item><Form.Item name="groupId" label="分组"><Select options={groups.map(g=>({value:g.id,label:g.name}))}/></Form.Item><Form.Item name="remark" label="备注"><Input/></Form.Item><Form.Item name="gamAccountRef" label="GAM账号引用"><Input/></Form.Item><Form.Item name="proxy" label="账号代理"><Input.Password/></Form.Item><Form.Item name="session" label="ChatGPT Session JSON"><Input.TextArea rows={10}/></Form.Item><Form.Item name="isBanned" label="人工封号" valuePropName="checked"><Switch/></Form.Item><Space><Button onClick={()=>navigate('/accounts')}>取消</Button><Button htmlType="submit" type="primary">创建账号</Button></Space>
  </Form><Divider>通过 GAM 注册</Divider><Form layout="vertical" onFinish={async(v)=>{try{const operation=await unifiedApi.registerAccount(v);navigate(`/operations/registrations/${operation.id}`);}catch(e){setError((e as Error).message);}}}><Form.Item name="groupId" label="注册后分组" rules={[{required:true}]}><Select options={groups.map(g=>({value:g.id,label:g.name}))}/></Form.Item><Form.Item name="email" label="指定邮箱（可选）"><Input/></Form.Item><Space align="start"><Form.Item name="country" label="国家" initialValue="US"><Input maxLength={2}/></Form.Item><Form.Item name="mailGroup" label="邮箱组"><Input/></Form.Item></Space><Button htmlType="submit">启动 GAM 注册</Button></Form></Card>;
}
