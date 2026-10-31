import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Avatar, Dropdown, Badge, theme } from 'antd';
import {
  DashboardOutlined, TeamOutlined, FunnelPlotOutlined, FileTextOutlined,
  AccountBookOutlined, ProjectOutlined,
   BellOutlined, UserOutlined, LogoutOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../stores/useAuthStore';

const { Header, Sider, Content } = Layout;

const menuItems = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: '工作台' },
  {
    key: 'customer-group', icon: <TeamOutlined />, label: '客户管理',
    children: [
      { key: '/customers', label: '我的客户' },
      { key: '/pool/public', label: '公海客户' },
      { key: '/pool/private', label: '我的私海' },
      { key: '/leads', label: '线索管理' },
    ],
  },
  {
    key: 'sales-group', icon: <FunnelPlotOutlined />, label: '销售管理',
    children: [
      { key: '/opportunities', label: '我的商机' },
      { key: '/opportunities/board', label: '商机看板' },

    ],
  },
  {
    key: 'contract-group', icon: <FileTextOutlined />, label: '合同订单',
    children: [
      { key: '/contracts', label: '合同管理' },
      { key: '/orders', label: '订单管理' },

    ],
  },
  {
    key: 'finance-group', icon: <AccountBookOutlined />, label: '财务中心',
    children: [
      { key: '/invoices', label: '发票管理' },
      { key: '/finance/payment-plans', label: '回款计划' },

      { key: '/finance/aging', label: '账龄分析' },
    ],
  },
  {
    key: 'project-group', icon: <ProjectOutlined />, label: '项目交付',
    children: [
      { key: '/projects', label: '项目列表' },

    ],
  },



];

export default function BasicLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const { token: themeToken } = theme.useToken();

  const handleMenuClick = ({ key }: { key: string }) => {
    if (key.startsWith('/')) navigate(key);
  };

  const userMenuItems = [
    { key: 'profile', icon: <UserOutlined />, label: '个人设置' },
    { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true },
  ];

  const handleUserMenu = ({ key }: { key: string }) => {
    if (key === 'logout') { logout(); navigate('/login'); }
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        width={220}
        style={{ background: themeToken.colorBgContainer, borderRight: `1px solid ${themeToken.colorBorderSecondary}` }}
      >
        <div style={{ padding: '16px 24px', borderBottom: `1px solid ${themeToken.colorBorderSecondary}` }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: themeToken.colorTextSecondary }}>
            PartnerOS
          </div>
          {!collapsed && (
            <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>CRM</div>
          )}
        </div>
        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          defaultOpenKeys={['customer-group', 'sales-group']}
          items={menuItems}
          onClick={handleMenuClick}
          style={{ borderRight: 0 }}
        />
      </Sider>
      <Layout>
        <Header style={{
          background: themeToken.colorBgContainer, padding: '0 24px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: `1px solid ${themeToken.colorBorderSecondary}`, height: 56,
        }}>
          <div style={{ fontSize: 14, color: themeToken.colorTextSecondary }}>
            上海町萌网络科技有限公司
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Badge dot={false}>
              <BellOutlined style={{ fontSize: 18, cursor: 'pointer' }} onClick={() => navigate('/notifications')} />
            </Badge>
            <Dropdown menu={{ items: userMenuItems, onClick: handleUserMenu }} placement="bottomRight">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <Avatar size={28} icon={<UserOutlined />} />
                <span style={{ fontSize: 13 }}>{user?.name || '用户'}</span>
              </div>
            </Dropdown>
          </div>
        </Header>
        <Content style={{ padding: 24, background: themeToken.colorBgLayout, overflow: 'auto' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
