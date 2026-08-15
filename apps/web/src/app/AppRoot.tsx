import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Alert, Skeleton } from 'antd';
import { AUTH_EXPIRED_EVENT, clearToken, getToken, setToken } from '../api.js';
import { AppShell } from './AppShell.js';

const Login=lazy(async()=>({default:(await import('../Login.js')).Login}));
const AccountsPage=lazy(async()=>({default:(await import('../features/unified/AccountsPage.js')).AccountsPage}));
const AccountDetailPage=lazy(async()=>({default:(await import('../features/unified/AccountDetailPage.js')).AccountDetailPage}));
const NewAccountPage=lazy(async()=>({default:(await import('../features/unified/NewAccountPage.js')).NewAccountPage}));
const PublicSeatPage=lazy(async()=>({default:(await import('../features/public-seat/PublicSeatPage.js')).PublicSeatPage}));
const TeamOrdersPage=lazy(async()=>({default:(await import('../features/unified/TeamOrdersPage.js')).TeamOrdersPage}));
const SettingsPage=lazy(async()=>({default:(await import('../features/unified/SettingsPage.js')).SettingsPage}));
const RegistrationOperationPage=lazy(async()=>({default:(await import('../features/unified/RegistrationOperationPage.js')).RegistrationOperationPage}));
const OverviewPage=lazy(async()=>({default:(await import('../features/unified/OverviewPage.js')).OverviewPage}));
const ArtifactsPage=lazy(async()=>({default:(await import('../features/unified/ArtifactsPage.js')).ArtifactsPage}));
const RrwebRecorder=lazy(async()=>({default:(await import('../features/unified/RrwebRecorder.js')).RrwebRecorder}));

export function AppRoot(){
  const navigate=useNavigate(); const location=useLocation(); const [authed,setAuthed]=useState(()=>Boolean(getToken())); const [error,setError]=useState('');
  useEffect(()=>{const expired=()=>{setAuthed(false);navigate('/login',{replace:true,state:{expired:true}});};window.addEventListener(AUTH_EXPIRED_EVENT,expired);return()=>window.removeEventListener(AUTH_EXPIRED_EVENT,expired);},[navigate]);
  const login=async(username:string,password:string)=>{const response=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});const body=await response.json();if(!response.ok||!body.ok)throw new Error(body.error??'登录失败');setToken(body.data.token);setAuthed(true);navigate('/accounts',{replace:true});};
  if(location.pathname.startsWith('/seat/'))return <Suspense fallback={<Skeleton active/>}><Routes><Route path="/seat/:seatKey" element={<PublicSeatPage/>}/><Route path="*" element={<Navigate to="/404" replace/>}/></Routes></Suspense>;
  if(!authed)return <Suspense fallback={<Skeleton active/>}><Routes><Route path="/login" element={<Login onLogin={login}/>}/><Route path="*" element={<Navigate to="/login" replace/>}/></Routes></Suspense>;
  return <AppShell onLogout={()=>{clearToken();setAuthed(false);navigate('/login',{replace:true});}}>{error&&<Alert type="error" showIcon closable message={error} onClose={()=>setError('')}/>}<Suspense fallback={<Skeleton active paragraph={{rows:8}}/>}><Routes>
    <Route path="/accounts" element={<AccountsPage/>}/><Route path="/accounts/new" element={<NewAccountPage/>}/><Route path="/accounts/:accountId" element={<AccountDetailPage/>}/><Route path="/operations/registrations/:operationId" element={<RegistrationOperationPage/>}/><Route path="/parent-overview" element={<OverviewPage kind="renewals"/>}/><Route path="/seat-overview" element={<OverviewPage kind="seats"/>}/><Route path="/team-orders" element={<TeamOrdersPage/>}/><Route path="/artifacts" element={<ArtifactsPage/>}/><Route path="/settings" element={<SettingsPage/>}/><Route path="/login" element={<Navigate to="/accounts" replace/>}/><Route path="/" element={<Navigate to="/accounts" replace/>}/><Route path="*" element={<Card404/>}/>
  </Routes></Suspense><Suspense fallback={null}><RrwebRecorder/></Suspense></AppShell>;
}
function Card404(){return <Alert type="warning" showIcon message="页面不存在" description="旧路由已删除，请从账号页进入。"/>;}
