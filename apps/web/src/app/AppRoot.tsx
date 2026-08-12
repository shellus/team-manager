import { lazy, Suspense, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Alert, Skeleton } from 'antd';
import { clearToken, getToken, setToken } from '../api.js';
import { AppShell } from './AppShell.js';

const Login=lazy(async()=>({default:(await import('../Login.js')).Login}));
const AccountsPage=lazy(async()=>({default:(await import('../features/unified/AccountsPage.js')).AccountsPage}));
const AccountDetailPage=lazy(async()=>({default:(await import('../features/unified/AccountDetailPage.js')).AccountDetailPage}));
const NewAccountPage=lazy(async()=>({default:(await import('../features/unified/NewAccountPage.js')).NewAccountPage}));
const WorkspacesPage=lazy(async()=>({default:(await import('../features/unified/WorkspacesPage.js')).WorkspacesPage}));
const WorkspaceDetailPage=lazy(async()=>({default:(await import('../features/unified/WorkspaceDetailPage.js')).WorkspaceDetailPage}));
const PublicSeatPage=lazy(async()=>({default:(await import('../features/public-seat/PublicSeatPage.js')).PublicSeatPage}));

export function AppRoot(){
  const navigate=useNavigate(); const location=useLocation(); const [authed,setAuthed]=useState(()=>Boolean(getToken())); const [error,setError]=useState('');
  const login=async(username:string,password:string)=>{const response=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});const body=await response.json();if(!response.ok||!body.ok)throw new Error(body.error??'登录失败');setToken(body.data.token);setAuthed(true);navigate('/accounts',{replace:true});};
  if(location.pathname.startsWith('/seat/'))return <Suspense fallback={<Skeleton active/>}><Routes><Route path="/seat/:seatKey" element={<PublicSeatPage/>}/><Route path="*" element={<Navigate to="/404" replace/>}/></Routes></Suspense>;
  if(!authed)return <Suspense fallback={<Skeleton active/>}><Routes><Route path="/login" element={<Login onLogin={login}/>}/><Route path="*" element={<Navigate to="/login" replace/>}/></Routes></Suspense>;
  return <AppShell onLogout={()=>{clearToken();setAuthed(false);navigate('/login',{replace:true});}}>{error&&<Alert type="error" showIcon closable message={error} onClose={()=>setError('')}/>}<Suspense fallback={<Skeleton active paragraph={{rows:8}}/>}><Routes>
    <Route path="/accounts" element={<AccountsPage/>}/><Route path="/accounts/new" element={<NewAccountPage/>}/><Route path="/accounts/:accountId" element={<AccountDetailPage/>}/><Route path="/workspaces" element={<WorkspacesPage/>}/><Route path="/workspaces/:workspaceId" element={<WorkspaceDetailPage/>}/><Route path="/login" element={<Navigate to="/accounts" replace/>}/><Route path="/" element={<Navigate to="/accounts" replace/>}/><Route path="*" element={<Card404/>}/>
  </Routes></Suspense></AppShell>;
}
function Card404(){return <Alert type="warning" showIcon message="页面不存在" description="旧母号/子号路由已删除，请从账号或 Workspace 进入。"/>;}
