import type { ReactNode } from 'react';
import { Button, Layout, Menu, Space, Switch, Typography } from 'antd';
import { AppstoreOutlined, DashboardOutlined, FileSearchOutlined, LogoutOutlined, MoonOutlined, SettingOutlined, ShoppingCartOutlined, UserOutlined } from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import { useThemeMode } from '../theme/ThemeProvider.js';
const {Header,Content}=Layout;
export function AppShell({children,onLogout}:{children:ReactNode;onLogout:()=>void}){
  const navigate=useNavigate();
  const location=useLocation();
  const {mode,toggleMode}=useThemeMode();
  const selected=location.pathname.startsWith('/seat-overview')
    ? 'seat-overview'
    : location.pathname.startsWith('/parent-overview')
      ? 'parent-overview'
      : location.pathname.split('/')[1]||'accounts';
  return <Layout className="app-shell">
    <Header className="app-header">
      <div className="brand-block"><Typography.Title level={1}>Team Manager</Typography.Title><Typography.Text type="secondary">账号与 Workspace</Typography.Text></div>
      <Menu
        className="app-nav"
        mode="horizontal"
        selectedKeys={[selected]}
        onClick={event=>navigate(`/${event.key}`)}
        items={[
          {key:'accounts',icon:<UserOutlined/>,label:'账号'},
          {key:'seat-overview',icon:<AppstoreOutlined/>,label:'席位概览'},
          {key:'parent-overview',icon:<DashboardOutlined/>,label:'母号概览'},
          {key:'team-orders',icon:<ShoppingCartOutlined/>,label:'Team 订单'},
          {key:'artifacts',icon:<FileSearchOutlined/>,label:'文件制品'},
          {key:'settings',icon:<SettingOutlined/>,label:'设置'}
        ]}
      />
      <Space className="header-actions"><Switch checked={mode==='dark'} checkedChildren={<MoonOutlined/>} unCheckedChildren="亮" onChange={toggleMode}/><Button icon={<LogoutOutlined/>} onClick={onLogout}>退出</Button></Space>
    </Header>
    <Content className="app-content">{children}</Content>
  </Layout>;
}
