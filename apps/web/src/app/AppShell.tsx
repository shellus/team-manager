import type { ReactNode } from 'react';
import { Button, Layout, Menu, Space, Switch, Typography } from 'antd';
import { LogoutOutlined, MoonOutlined, TeamOutlined, UserOutlined } from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import { useThemeMode } from '../theme/ThemeProvider.js';
const {Header,Content}=Layout;
export function AppShell({children,onLogout}:{children:ReactNode;onLogout:()=>void}){const navigate=useNavigate();const location=useLocation();const {mode,toggleMode}=useThemeMode();const selected=location.pathname.startsWith('/workspaces')?'workspaces':'accounts';return <Layout className="app-shell"><Header className="app-header"><div className="brand-block"><Typography.Title level={1}>Team Manager</Typography.Title><Typography.Text type="secondary">账号与 Workspace</Typography.Text></div><Menu className="app-nav" mode="horizontal" selectedKeys={[selected]} onClick={e=>navigate(`/${e.key}`)} items={[{key:'accounts',icon:<UserOutlined/>,label:'账号'},{key:'workspaces',icon:<TeamOutlined/>,label:'Workspaces'}]}/><Space className="header-actions"><Switch checked={mode==='dark'} checkedChildren={<MoonOutlined/>} unCheckedChildren="亮" onChange={toggleMode}/><Button icon={<LogoutOutlined/>} onClick={onLogout}>退出</Button></Space></Header><Content className="app-content">{children}</Content></Layout>;}
