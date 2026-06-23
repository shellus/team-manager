import type { ReactNode } from 'react';
import { Button, Layout, Menu, Space, Switch, Typography } from 'antd';
import { LogoutOutlined, MoonOutlined, TeamOutlined, UserSwitchOutlined } from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import { useThemeMode } from '../theme/ThemeProvider.js';

const { Header, Content } = Layout;

export function AppShell({
  children,
  onLogout
}: {
  children: ReactNode;
  onLogout: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { mode, toggleMode } = useThemeMode();
  const selectedKey = location.pathname.startsWith('/subaccounts') ? 'subaccounts' : 'parents';

  return (
    <Layout className="app-shell">
      <Header className="app-header">
        <div className="brand-block">
          <Typography.Title level={1}>Team 管理</Typography.Title>
          <Typography.Text type="secondary">母号、子号、席位和 Codex 凭证</Typography.Text>
        </div>
        <Menu
          className="app-nav"
          mode="horizontal"
          selectedKeys={[selectedKey]}
          onClick={(event) => navigate(event.key === 'subaccounts' ? '/subaccounts' : '/parents')}
          items={[
            { key: 'parents', icon: <TeamOutlined />, label: '母号' },
            { key: 'subaccounts', icon: <UserSwitchOutlined />, label: '子号' }
          ]}
        />
        <Space className="header-actions" size={12}>
          <Switch
            checked={mode === 'dark'}
            checkedChildren={<MoonOutlined />}
            unCheckedChildren="亮"
            onChange={toggleMode}
          />
          <Button icon={<LogoutOutlined />} onClick={onLogout}>
            退出
          </Button>
        </Space>
      </Header>
      <Content className="app-content">{children}</Content>
    </Layout>
  );
}
