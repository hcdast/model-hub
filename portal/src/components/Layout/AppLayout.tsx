import { ReactNode, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Input, Avatar, Dropdown, Badge } from 'antd';
import {
  SearchOutlined,
  HomeOutlined,
  AppstoreOutlined,
  SettingOutlined,
  BellOutlined,
  UserOutlined,
  LogoutOutlined,
  GithubOutlined,
  QuestionCircleOutlined,
  KeyOutlined,
  ProfileOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import tokens from '../../theme/dark';
import { useAuthStore } from '../../store/auth-store';

interface AppLayoutProps {
  children: ReactNode;
}

const navItems = [
  { path: '/', label: 'Home', icon: <HomeOutlined /> },
  { path: '/workflows', label: 'Workflows', icon: <AppstoreOutlined /> },
  { path: '/templates', label: 'Templates', icon: <SettingOutlined /> },
  { path: '/community', label: 'Community', icon: <TeamOutlined /> },
];

export default function AppLayout({ children }: AppLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const [searchValue, setSearchValue] = useState('');

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const userMenuItems = [
    {
      key: 'profile',
      icon: <ProfileOutlined />,
      label: 'Profile',
      onClick: () => navigate('/profile'),
    },
    {
      key: 'api-keys',
      icon: <KeyOutlined />,
      label: 'API Keys',
      onClick: () => navigate('/settings/api-keys'),
    },
    { type: 'divider' as const },
    {
      key: 'help',
      icon: <QuestionCircleOutlined />,
      label: 'Help & Docs',
    },
    {
      key: 'github',
      icon: <GithubOutlined />,
      label: 'GitHub',
    },
    { type: 'divider' as const },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: 'Logout',
      danger: true,
      onClick: handleLogout,
    },
  ];

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      background: tokens.bg.primary,
    }}>
      {/* 顶部导航栏 */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 64,
        padding: `0 ${tokens.spacing.xl}`,
        background: tokens.bg.secondary,
        borderBottom: `1px solid ${tokens.border.default}`,
        backdropFilter: 'blur(12px)',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        {/* 左侧：Logo + 导航 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: tokens.spacing.xl }}>
          {/* Logo */}
          <Link to="/" style={{
            display: 'flex',
            alignItems: 'center',
            gap: tokens.spacing.sm,
            textDecoration: 'none',
          }}>
            <div style={{
              width: 32,
              height: 32,
              borderRadius: tokens.radius.md,
              background: tokens.accent.gradient,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 16,
              fontWeight: 700,
              color: '#fff',
            }}>
              M
            </div>
            <span style={{
              fontSize: tokens.font.size.lg,
              fontWeight: tokens.font.weight.semibold,
              color: tokens.text.primary,
              letterSpacing: '-0.02em',
            }}>
              Model Hub
            </span>
          </Link>

          {/* 导航菜单 */}
          <nav style={{ display: 'flex', gap: tokens.spacing.xs }}>
            {navItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: tokens.spacing.sm,
                  padding: `${tokens.spacing.sm} ${tokens.spacing.md}`,
                  borderRadius: tokens.radius.md,
                  fontSize: tokens.font.size.base,
                  fontWeight: isActive(item.path) ? tokens.font.weight.medium : tokens.font.weight.normal,
                  color: isActive(item.path) ? tokens.text.primary : tokens.text.secondary,
                  background: isActive(item.path) ? tokens.bg.hover : 'transparent',
                  textDecoration: 'none',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  if (!isActive(item.path)) {
                    e.currentTarget.style.color = tokens.text.primary;
                    e.currentTarget.style.background = tokens.bg.hover;
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive(item.path)) {
                    e.currentTarget.style.color = tokens.text.secondary;
                    e.currentTarget.style.background = 'transparent';
                  }
                }}
              >
                {item.icon}
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        {/* 右侧：搜索 + 通知 + 用户 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: tokens.spacing.md }}>
          {/* 搜索框 */}
          <Input
            prefix={<SearchOutlined style={{ color: tokens.text.tertiary }} />}
            placeholder="Search workflows..."
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            style={{
              width: 280,
              background: tokens.bg.tertiary,
              borderColor: tokens.border.default,
              borderRadius: tokens.radius.md,
            }}
            onPressEnter={() => {
              if (searchValue) {
                navigate(`/workflows?search=${searchValue}`);
              }
            }}
          />

          {/* 通知 */}
          <Badge count={3} size="small">
            <div style={{
              width: 36,
              height: 36,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: tokens.radius.md,
              background: tokens.bg.tertiary,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}>
              <BellOutlined style={{ color: tokens.text.secondary, fontSize: 16 }} />
            </div>
          </Badge>

          {/* 用户头像 */}
          <Dropdown
            menu={{ items: userMenuItems }}
            placement="bottomRight"
            trigger={['click']}
          >
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: tokens.spacing.sm,
              padding: `${tokens.spacing.xs} ${tokens.spacing.sm}`,
              borderRadius: tokens.radius.md,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}>
              <Avatar
                size={32}
                src={user?.avatar}
                icon={<UserOutlined />}
                style={{
                  background: tokens.accent.primary,
                  cursor: 'pointer',
                }}
              />
              <span style={{
                fontSize: tokens.font.size.sm,
                color: tokens.text.primary,
                maxWidth: 100,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {user?.username || 'User'}
              </span>
            </div>
          </Dropdown>
        </div>
      </header>

      {/* 主内容区 */}
      <main style={{
        flex: 1,
        overflow: 'auto',
        background: tokens.bg.primary,
      }}>
        {children}
      </main>
    </div>
  );
}
