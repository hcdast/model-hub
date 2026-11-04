import { ReactNode, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Input, Avatar, Dropdown, Button } from 'antd';
import { SearchOutlined, HomeOutlined, AppstoreOutlined, CompassOutlined, UserOutlined, LogoutOutlined, GithubOutlined, QuestionCircleOutlined, KeyOutlined, ProfileOutlined, ApiOutlined, BookOutlined, VideoCameraOutlined } from '@ant-design/icons';
import tokens from '../../theme/dark';
import { useAuthStore } from '../../store/auth-store';
import { useI18n } from '../../i18n';
import LanguageSwitcher from './LanguageSwitcher';
import BrandIcon from '../BrandIcon';
import NotificationBell from './NotificationBell';
import '../../styles/portal-shell.css';

const navItems = [
  { path: '/', label: 'Home', icon: <HomeOutlined /> },
  { path: '/workflows', label: 'My workflows', icon: <AppstoreOutlined /> },
  { path: '/short-dramas', label: 'Short dramas', icon: <VideoCameraOutlined /> },
  { path: '/discover', label: 'Discover', icon: <CompassOutlined /> },
  { path: '/models', label: 'Models', icon: <ApiOutlined /> },
  { path: '/docs', label: 'Model docs', icon: <BookOutlined /> },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAuthenticated, logout } = useAuthStore();
  const { t } = useI18n();
  const [searchValue, setSearchValue] = useState('');
  const searchModels = location.pathname.startsWith('/models') || location.pathname === '/docs';
  const searchTemplates = location.pathname.startsWith('/discover') || location.pathname.startsWith('/templates');
  const searchPlaceholder = searchModels ? 'Search models...' : searchTemplates ? 'Search templates...' : 'Search workflows...';
  const isActive = (path: string) => path === '/' ? location.pathname === '/' : location.pathname.startsWith(path) || (path === '/discover' && location.pathname.startsWith('/templates'));
  const userMenuItems = [
    { key: 'profile', icon: <ProfileOutlined />, label: t('Profile'), onClick: () => navigate('/profile') },
    { key: 'api-keys', icon: <KeyOutlined />, label: t('API Keys'), onClick: () => navigate('/settings/api-keys') },
    { type: 'divider' as const },
    { key: 'help', icon: <QuestionCircleOutlined />, label: t('Help & Docs'), onClick: () => navigate('/docs') },
    { key: 'github', icon: <GithubOutlined />, label: 'GitHub' },
    { type: 'divider' as const },
    { key: 'logout', icon: <LogoutOutlined />, label: t('Logout'), danger: true, onClick: async () => { await logout(); navigate('/'); } },
  ];

  return <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: tokens.bg.primary }}>
    <header className="portal-topbar" style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 64, flexShrink: 0,
      padding: `0 ${tokens.spacing.xl}`, background: tokens.bg.secondary, borderBottom: `1px solid ${tokens.border.default}`,
      backdropFilter: 'blur(12px)', position: 'sticky', top: 0, zIndex: 100,
    }}>
      <div className="portal-topbar-left">
        <Link to="/" aria-label="Model Hub" className="portal-topbar-brand" style={{ display: 'flex', alignItems: 'center', gap: tokens.spacing.sm, textDecoration: 'none' }}>
          <BrandIcon />
          <span style={{ fontSize: tokens.font.size.lg, fontWeight: tokens.font.weight.semibold, color: tokens.text.primary, letterSpacing: '-0.02em' }}>Model Hub</span>
        </Link>
        <nav aria-label={t('Main navigation')} className="portal-topbar-nav">
          {navItems.map(item => <Link key={item.path} to={item.path} aria-current={isActive(item.path) ? 'page' : undefined} style={{
            display: 'flex', alignItems: 'center', gap: tokens.spacing.sm,
            padding: `${tokens.spacing.sm} ${tokens.spacing.md}`, borderRadius: tokens.radius.md,
            fontSize: tokens.font.size.base, fontWeight: isActive(item.path) ? tokens.font.weight.medium : tokens.font.weight.normal,
            color: isActive(item.path) ? tokens.text.primary : tokens.text.secondary,
            background: isActive(item.path) ? tokens.bg.hover : 'transparent', textDecoration: 'none', transition: 'all 0.2s ease',
          }} onMouseEnter={event => { if (!isActive(item.path)) { event.currentTarget.style.color = tokens.text.primary; event.currentTarget.style.background = tokens.bg.hover; } }}
          onMouseLeave={event => { if (!isActive(item.path)) { event.currentTarget.style.color = tokens.text.secondary; event.currentTarget.style.background = 'transparent'; } }}>
            {item.icon}{t(item.label)}
          </Link>)}
        </nav>
      </div>
      <div className="portal-topbar-actions">
        <Input className="portal-topbar-search" aria-label={t(searchPlaceholder)}
          prefix={<SearchOutlined style={{ color: tokens.text.tertiary }} />}
          placeholder={t(searchPlaceholder)} value={searchValue}
          onChange={event => setSearchValue(event.target.value)}
          style={{ width: 220, background: tokens.bg.tertiary, borderColor: tokens.border.default, borderRadius: tokens.radius.md }}
          onPressEnter={() => { if (searchValue.trim()) navigate(`${searchModels ? '/models' : searchTemplates ? '/discover' : '/workflows'}?search=${encodeURIComponent(searchValue.trim())}`); }} />
        <LanguageSwitcher />
        {isAuthenticated && user && <NotificationBell key={user.id} />}
        {isAuthenticated ? <Dropdown menu={{ items: userMenuItems }} placement="bottomRight" trigger={['click']}>
          <div style={{ display: 'flex', alignItems: 'center', gap: tokens.spacing.sm, padding: `${tokens.spacing.xs} ${tokens.spacing.sm}`, borderRadius: tokens.radius.md, cursor: 'pointer' }}>
            <Avatar size={32} src={user?.avatar} icon={<UserOutlined />} style={{ background: tokens.accent.primary }} />
            <span style={{ fontSize: tokens.font.size.sm, color: tokens.text.primary, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.username || 'User'}</span>
          </div>
        </Dropdown> : <div className="portal-topbar-auth">
          <Button onClick={() => navigate('/login', { state: { from: location } })}>{t('Sign in')}</Button>
          <Button type="primary" onClick={() => navigate('/register', { state: { from: location } })}>{t('Sign up')}</Button>
        </div>}
      </div>
    </header>
    <main style={{ flex: 1, overflow: 'auto', background: tokens.bg.primary }}>{children}</main>
  </div>;
}
