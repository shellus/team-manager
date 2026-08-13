import { useState } from "react";
import { Alert, Button, Form, Input, Modal, Space, Typography } from "antd";
import type { WorkspaceCredentialView } from "@team-manager/shared";
import { unifiedApi } from "../unifiedApi.js";

export function WorkspaceCredentialActions({ credential, run }: {
  credential: WorkspaceCredentialView;
  run: (key:string, action:()=>Promise<unknown>)=>Promise<unknown>;
}) {
  const [deployOpen,setDeployOpen]=useState(false);
  const [oauth,setOauth]=useState<{sessionId:string;authUrl:string;poolGroupId?:string}>();
  const [callback,setCallback]=useState("");
  const [error,setError]=useState("");
  const startOauth=async()=>{setError("");try{const result=await unifiedApi.createOauthCredential(credential.accountId,credential.workspaceId);setOauth({...result,poolGroupId:credential.poolGroup?.id});window.open(result.authUrl,"_blank","noopener,noreferrer");}catch(reason){setError((reason as Error).message);}};
  return <>
    <Space wrap>
      <Button size="small" onClick={()=>run(`quota-${credential.id}`,()=>unifiedApi.refreshCredentialQuota(credential.id))}>刷新额度</Button>
      {credential.kind==="oauth"&&<Button size="small" onClick={()=>void startOauth()}>OAuth 重新授权</Button>}
      {credential.kind==="pat"&&<Button size="small" onClick={()=>run(`pat-${credential.id}`,()=>unifiedApi.createPatCredential(credential.accountId,credential.workspaceId,{name:`team-manager-${new Date().toISOString().slice(0,10)}`,poolGroupId:credential.poolGroup?.id}))}>重新创建 PAT</Button>}
      <Button size="small" onClick={()=>run(`status-${credential.id}`,()=>unifiedApi.updateCredential(credential.id,{status:credential.status==="disabled"?"active":"disabled"}))}>{credential.status==="disabled"?"启用":"停用"}</Button>
      <Button size="small" disabled={credential.status!=="active"} onClick={()=>setDeployOpen(true)}>投放</Button>
      <Button size="small" danger disabled={credential.status==="active"} onClick={()=>Modal.confirm({title:"删除凭证？",content:"只删除已停用的本地凭证记录和制品引用。",onOk:()=>run(`delete-${credential.id}`,()=>unifiedApi.deleteCredential(credential.id))})}>删除</Button>
    </Space>
    {error&&<Alert type="error" showIcon message={error}/>} 
    <Modal title="投放凭证到号池" open={deployOpen} footer={null} onCancel={()=>setDeployOpen(false)} destroyOnHidden>
      <Form layout="vertical" initialValues={{targetKey:"default"}} onFinish={async(value)=>{await run(`deploy-${credential.id}`,()=>unifiedApi.deployCredential(credential.id,value));setDeployOpen(false);}}>
        <Form.Item name="targetKey" label="目标键" rules={[{required:true,message:"请输入目标键"}]}><Input/></Form.Item>
        <Form.Item name="fileName" label="文件名（可选）"><Input/></Form.Item>
        <Button type="primary" htmlType="submit">确认投放</Button>
      </Form>
    </Modal>
    <Modal title="完成 OAuth 授权" open={Boolean(oauth)} footer={null} onCancel={()=>setOauth(undefined)} destroyOnHidden>
      <Alert type="info" showIcon message="在新窗口完成授权，再粘贴完整回调 URL。"/>
      <Typography.Paragraph copyable={{text:oauth?.authUrl}}>{oauth?.authUrl}</Typography.Paragraph>
      <Input.TextArea rows={4} value={callback} onChange={event=>setCallback(event.target.value)} placeholder="完整 OAuth callback URL"/>
      <Button type="primary" disabled={!callback.trim()} onClick={()=>oauth&&run(`oauth-complete-${credential.id}`,()=>unifiedApi.completeOauthCredential(oauth.sessionId,callback,oauth.poolGroupId)).then(()=>setOauth(undefined))}>完成 OAuth 凭证</Button>
    </Modal>
  </>;
}
