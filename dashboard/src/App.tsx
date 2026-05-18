import { useState, useEffect, type CSSProperties, type ReactNode } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Typography, Avatar, Dropdown, theme, Modal, Form, Input, message, Spin, Badge, Space, ConfigProvider, Button } from 'antd';
import type { MenuProps } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import {
  DashboardOutlined, UnorderedListOutlined, CloudServerOutlined,
  BarChartOutlined, AuditOutlined, UserOutlined, LogoutOutlined,
  AppstoreOutlined, KeyOutlined, BranchesOutlined, ApiOutlined,
  TeamOutlined, SafetyOutlined, LockOutlined, WalletOutlined,
  ClusterOutlined, BellOutlined, FileTextOutlined, NotificationOutlined,
  SettingOutlined, SunOutlined, MoonOutlined, HeartOutlined,
  FileSearchOutlined, SyncOutlined, DatabaseOutlined, DollarOutlined, MailOutlined,
  LinkOutlined, MenuOutlined, ThunderboltOutlined, ExperimentOutlined, RobotOutlined,
  LayoutOutlined, ControlOutlined,
} from '@ant-design/icons';
import { BrandMark } from './components/BrandMark';
import { buildAntdTheme } from './theme/antd-theme';
import { useAuthStore } from './store/auth';
import { usePermission } from './hooks/usePermission';
import { useMenuStore, type MenuGroup, type MenuItem as SidebarMenuItem } from './store/menu';
import { useThemeStore } from './store/theme';
import { userApi, inAppNotificationApi } from './services/api';
import LoginPage from './pages/Login';
import DashboardPage from './pages/Dashboard';
import TasksPage from './pages/Tasks';
import TaskDetailPage from './pages/TaskDetail';
import QueuesPage from './pages/Queues';
import StatsPage from './pages/Stats';
import AuditLogsPage from './pages/AuditLogs';
import ModelsPage from './pages/Models';
import CreateModelConfigPage from './pages/CreateModelConfig';
import EditModelConfigPage from './pages/EditModelConfig';
import ApiClientsPage from './pages/ApiClients';
import ModelRoutingRulesPage from './pages/ModelRoutingRules';
import ProviderConfigsPage from './pages/ProviderConfigs';
import UsersPage from './pages/Users';
import RolesPage from './pages/Roles';
import PermissionsPage from './pages/Permissions';
import AccountPoolPage from './pages/AccountPool';
import AccountCostPage from './pages/AccountCost';
import NotificationRulesPage from './pages/NotificationRules';
import NotificationRecordsPage from './pages/NotificationRecords';
import InAppNotificationsPage from './pages/InAppNotifications';
import ForbiddenPage from './pages/Forbidden';
import ProviderHealthPage from './pages/ProviderHealth';
import BillingRecordsPage from './pages/BillingRecords';
import WalletManagementPage from './pages/WalletManagement';
import LinkConversionConfigPage from './pages/LinkConversionConfig';
import CallbackLogsPage from './pages/CallbackLogs';
import SystemInfoPage from './pages/SystemInfo';
import MenusPage from './pages/Menus';
import NotFoundPage from './pages/NotFound';

const { Header, Sider, Content } = Layout;

/**
 * 图标名称字符串 → React 组件映射表。
 * 后端菜单 `icon` 字段须与本表键名一致；可选扩展名：ThunderboltOutlined、ExperimentOutlined、RobotOutlined、LayoutOutlined 等。
 */
const iconMap: Record<string, ReactNode> = {
  DashboardOutlined: <DashboardOutlined />,
  UnorderedListOutlined: <UnorderedListOutlined />,
  CloudServerOutlined: <CloudServerOutlined />,
  BarChartOutlined: <BarChartOutlined />,
  AuditOutlined: <AuditOutlined />,
  UserOutlined: <UserOutlined />,
  AppstoreOutlined: <AppstoreOutlined />,
  KeyOutlined: <KeyOutlined />,
  BranchesOutlined: <BranchesOutlined />,
  ApiOutlined: <ApiOutlined />,
  TeamOutlined: <TeamOutlined />,
  SafetyOutlined: <SafetyOutlined />,
  LockOutlined: <LockOutlined />,
  WalletOutlined: <WalletOutlined />,
  ClusterOutlined: <ClusterOutlined />,
  BellOutlined: <BellOutlined />,
  FileTextOutlined: <FileTextOutlined />,
  NotificationOutlined: <NotificationOutlined />,
  SettingOutlined: <SettingOutlined />,
  HeartOutlined: <HeartOutlined />,
  FileSearchOutlined: <FileSearchOutlined />,
  SyncOutlined: <SyncOutlined />,
  DatabaseOutlined: <DatabaseOutlined />,
  DollarOutlined: <DollarOutlined />,
  MailOutlined: <MailOutlined />,
  LinkOutlined: <LinkOutlined />,
  MenuOutlined: <MenuOutlined />,
  ThunderboltOutlined: <ThunderboltOutlined />,
  ExperimentOutlined: <ExperimentOutlined />,
  RobotOutlined: <RobotOutlined />,
  LayoutOutlined: <LayoutOutlined />,
};

/** 解析图标名称为 React 组件，未匹配时使用中性默认图标 */
function resolveIcon(iconName?: string): ReactNode {
  if (!iconName) return undefined;
  return iconMap[iconName] ?? <ControlOutlined />;
}

function matchesSidebarPath(item: SidebarMenuItem, pathname: string): boolean {
  if (!item.path) return false;
  if (item.path === '/') return pathname === '/';
  return pathname.startsWith(item.path);
}

function hasMatchUnderItem(item: SidebarMenuItem, pathname: string): boolean {
  if (matchesSidebarPath(item, pathname)) return true;
  return item.children?.some((c) => hasMatchUnderItem(c, pathname)) ?? false;
}

/** 在分组子树中查找与当前路径匹配的叶子路由 path */
function findLeafPathInItems(items: SidebarMenuItem[], pathname: string): string | null {
  for (const item of items) {
    if (item.children?.length) {
      const nested = findLeafPathInItems(item.children, pathname);
      if (nested) return nested;
    }
    if (matchesSidebarPath(item, pathname)) {
      return item.path || item.key;
    }
  }
  return null;
}

/** 子树中是否存在匹配（用于展开父级 SubMenu） */
function submenuKeysForMatch(items: SidebarMenuItem[], pathname: string): string[] {
  for (const item of items) {
    if (!item.children?.length) continue;
    if (hasMatchUnderItem(item, pathname)) {
      return [`sub-${item.key}`, ...submenuKeysForMatch(item.children, pathname)];
    }
  }
  return [];
}

type AntdSidebarItem = NonNullable<MenuProps['items']>[number];

/** 将后端菜单项（可多级）映射为 Ant Design Menu items */
function mapMenuItemToAntd(item: SidebarMenuItem): AntdSidebarItem {
  const subs = item.children?.filter(Boolean);
  if (subs && subs.length > 0) {
    return {
      key: `sub-${item.key}`,
      icon: resolveIcon(item.icon),
      label: item.label,
      children: subs.map(mapMenuItemToAntd),
    };
  }
  return {
    key: item.path || item.key,
    icon: resolveIcon(item.icon),
    label: item.label,
  };
}

/**
 * 将后端返回的 MenuGroup[] 转换为 Ant Design Menu 组件的 items 格式
 * 一级为分组 SubMenu；分组下支持多级子菜单（子项带 children 时继续嵌套 SubMenu）
 */
function buildAntdMenuItems(groups: MenuGroup[]): MenuProps['items'] {
  return groups.map((group) => {
    const only = group.children[0];
    if (
      group.children.length === 1
      && only.path
      && (!only.children || only.children.length === 0)
    ) {
      return {
        key: only.path,
        icon: resolveIcon(only.icon || group.icon),
        label: only.label,
      };
    }
    return {
      key: `group-${group.key}`,
      icon: resolveIcon(group.icon),
      label: group.label,
      children: group.children.map(mapMenuItemToAntd),
    };
  });
}

/** 根据当前路径查找选中的菜单项 key */
function findSelectedKey(groups: MenuGroup[], pathname: string): string[] {
  for (const group of groups) {
    const hit = findLeafPathInItems(group.children, pathname);
    if (hit) return [hit];
  }
  return ['/'];
}

/** 根据当前路径查找需要展开的 SubMenu key（分组 + 中间级菜单） */
function findOpenKeys(groups: MenuGroup[], pathname: string): string[] {
  const keys: string[] = [];
  for (const group of groups) {
    const chain = submenuKeysForMatch(group.children, pathname);
    // 路径命中分组下任意菜单项（含一级叶子，如 /users），都应展开该分组
    const hitInGroup = group.children.some((child) => hasMatchUnderItem(child, pathname));
    if (chain.length > 0 || hitInGroup) {
      keys.push(`group-${group.key}`, ...chain);
    }
  }
  return keys;
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** 路由级权限检查 — 用户无权限时重定向到 /forbidden 页面 */
function PermissionRoute({ permission, children }: { permission?: string; children: React.ReactNode }) {
  const { permissions, roles } = useAuthStore();
  if (!permission) return <>{children}</>;
  // super_admin 角色始终拥有完整访问权限（兼容 localStorage 中无权限数据的旧会话）
  if (roles.includes('super_admin')) return <>{children}</>;
  if (permissions.includes('*') || permissions.includes(permission)) return <>{children}</>;
  return <Navigate to="/forbidden" replace />;
}

function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const username = useAuthStore((s) => s.username);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      await userApi.changePassword('me', {
        oldPassword: values.oldPassword,
        newPassword: values.newPassword,
      });
      message.success('密码修改成功');
      form.resetFields();
      onClose();
    } catch (err: any) {
      if (err?.response?.data?.message) {
        message.error(err.response.data.message);
      } else if (err?.errorFields) {
        // form validation error, ignore
      } else {
        message.error('密码修改失败');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="修改密码"
      open={open}
      onOk={handleOk}
      onCancel={() => { form.resetFields(); onClose(); }}
      confirmLoading={loading}
      destroyOnClose
    >
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item label="当前用户">
          <Input value={username || ''} disabled />
        </Form.Item>
        <Form.Item
          name="oldPassword"
          label="旧密码"
          rules={[{ required: true, message: '请输入旧密码' }]}
        >
          <Input.Password placeholder="请输入旧密码" />
        </Form.Item>
        <Form.Item
          name="newPassword"
          label="新密码"
          rules={[
            { required: true, message: '请输入新密码' },
            { min: 8, message: '密码至少8个字符' },
            {
              pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/,
              message: '密码需包含大小写字母和数字',
            },
          ]}
        >
          <Input.Password placeholder="请输入新密码" />
        </Form.Item>
        <Form.Item
          name="confirmPassword"
          label="确认新密码"
          dependencies={['newPassword']}
          rules={[
            { required: true, message: '请确认新密码' },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('newPassword') === value) {
                  return Promise.resolve();
                }
                return Promise.reject(new Error('两次输入的密码不一致'));
              },
            }),
          ]}
        >
          <Input.Password placeholder="请再次输入新密码" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { username, logout } = useAuthStore();
  const { hasPermission } = usePermission();
  const canInAppNotifications = hasPermission('notification:read');
  const { menuGroups, loading: menuLoading, fetchMenu } = useMenuStore();
  const {
    token: {
      colorBgContainer,
      borderRadiusLG,
      colorBgLayout,
      colorBorderSecondary,
      colorPrimary,
      colorText,
    },
  } = theme.useToken();
  const toggleTheme = useThemeStore((s) => s.toggle);
  const themeMode = useThemeStore((s) => s.mode);
  const [changePwdOpen, setChangePwdOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [menuOpenKeys, setMenuOpenKeys] = useState<string[]>([]);

  const siderStyle: CSSProperties = {
    background: 'linear-gradient(180deg, #0f172a 0%, #0c1526 48%, #0a1628 100%)',
    borderRight: `1px solid ${themeMode === 'dark' ? 'rgba(148, 163, 184, 0.12)' : 'rgba(148, 163, 184, 0.18)'}`,
    boxShadow: '4px 0 24px rgba(15, 23, 42, 0.12)',
    height: '100%',
    overflowY: 'auto',
    flexShrink: 0,
  };

  const fetchUnreadCount = async () => {
    try {
      const res: any = await inAppNotificationApi.unreadCount();
      setUnreadCount(res.data?.count || 0);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    fetchMenu();
  }, [fetchMenu]);

  useEffect(() => {
    setMenuOpenKeys(findOpenKeys(menuGroups, location.pathname));
  }, [menuGroups, location.pathname]);

  useEffect(() => {
    if (!canInAppNotifications) {
      setUnreadCount(0);
      return;
    }
    fetchUnreadCount();
    const timer = setInterval(fetchUnreadCount, 60000);
    return () => clearInterval(timer);
  }, [canInAppNotifications]);

  const antdMenuItems = buildAntdMenuItems(menuGroups);
  const selectedKeys = findSelectedKey(menuGroups, location.pathname);

  return (
    <Layout
      style={{
        height: '100%',
        maxHeight: '100%',
        overflow: 'hidden',
        background: colorBgLayout,
      }}
    >
      <Sider width={232} theme="dark" breakpoint="lg" collapsedWidth={60} style={siderStyle}>
        <div
          style={{
            height: 56,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            padding: '0 12px',
            borderBottom: '1px solid rgba(148, 163, 184, 0.15)',
          }}
        >
          <BrandMark size={26} />
          <Typography.Title level={5} style={{ color: '#f8fafc', margin: 0, fontWeight: 600, letterSpacing: '-0.02em' }}>
            Model-Hub
          </Typography.Title>
        </div>
        {menuLoading ? (
          <div style={{ textAlign: 'center', padding: 24 }}><Spin size="small" /></div>
        ) : (
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={selectedKeys}
            openKeys={menuOpenKeys}
            onOpenChange={(keys) => setMenuOpenKeys(keys as string[])}
            items={antdMenuItems}
            style={{ background: 'transparent', borderInlineEnd: 'none' }}
            onClick={({ key }) => {
              if (key.startsWith('group-') || key.startsWith('sub-')) return;
              navigate(key);
            }}
          />
        )}
      </Sider>
      <Layout
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          height: '100%',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          background: colorBgLayout,
        }}
      >
        <Header
          style={{
            flexShrink: 0,
            padding: '0 20px',
            height: 56,
            lineHeight: '56px',
            background: colorBgContainer,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: `1px solid ${colorBorderSecondary}`,
            boxShadow: '0 1px 0 rgba(15, 23, 42, 0.04)',
          }}
        >
          <Typography.Text strong style={{ color: colorText, fontSize: 15, letterSpacing: '-0.01em' }}>
            管理后台
          </Typography.Text>
          <Space size="middle">
            {canInAppNotifications && (
              <Badge count={unreadCount} size="small" offset={[-2, 2]}>
                <BellOutlined
                  style={{ fontSize: 18, cursor: 'pointer' }}
                  onClick={() => navigate('/notifications')}
                />
              </Badge>
            )}
            <Button
              type="text"
              icon={themeMode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
              onClick={toggleTheme}
              style={{ fontSize: 18 }}
            />
            <Dropdown
              menu={{
                items: [
                  { key: 'user', label: username || 'admin', icon: <UserOutlined />, disabled: true },
                  { type: 'divider' },
                  {
                    key: 'change-password',
                    label: '修改密码',
                    icon: <LockOutlined />,
                    onClick: () => setChangePwdOpen(true),
                  },
                  {
                    key: 'logout',
                    label: '退出登录',
                    icon: <LogoutOutlined />,
                    danger: true,
                    onClick: () => {
                      logout();
                      navigate('/login');
                    },
                  },
                ],
              }}
            >
              <Avatar icon={<UserOutlined />} style={{ cursor: 'pointer', backgroundColor: colorPrimary }} />
            </Dropdown>
          </Space>
        </Header>
        <Content
          style={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            margin: 20,
            padding: 0,
            background: 'transparent',
          }}
        >
          <div
            style={{
              padding: 24,
              minHeight: 'calc(100vh - 56px - 40px)',
              background: colorBgContainer,
              borderRadius: borderRadiusLG,
              border: `1px solid ${colorBorderSecondary}`,
              boxShadow: themeMode === 'dark' ? '0 0 0 1px rgba(255,255,255,0.04) inset' : '0 4px 24px rgba(15, 23, 42, 0.06)',
            }}
          >
            <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/tasks" element={<PermissionRoute permission="task:read"><TasksPage /></PermissionRoute>} />
            <Route path="/tasks/:taskId" element={<PermissionRoute permission="task:read"><TaskDetailPage /></PermissionRoute>} />
            <Route path="/queues" element={<PermissionRoute permission="queue:read"><QueuesPage /></PermissionRoute>} />
            <Route path="/models" element={<PermissionRoute permission="model:read"><ModelsPage /></PermissionRoute>} />
            <Route path="/models/create" element={<PermissionRoute permission="model:create"><CreateModelConfigPage /></PermissionRoute>} />
            <Route path="/models/edit/:id" element={<PermissionRoute permission="model:update"><EditModelConfigPage /></PermissionRoute>} />
            <Route path="/model-routing-rules" element={<PermissionRoute permission="model:read"><ModelRoutingRulesPage /></PermissionRoute>} />
            <Route path="/provider-configs" element={<PermissionRoute permission="provider:read"><ProviderConfigsPage /></PermissionRoute>} />
            <Route path="/provider-health" element={<PermissionRoute permission="provider:read"><ProviderHealthPage /></PermissionRoute>} />
            <Route path="/account-pool" element={<PermissionRoute permission="provider:read"><AccountPoolPage /></PermissionRoute>} />
            <Route path="/account-costs" element={<PermissionRoute permission="provider:read"><AccountCostPage /></PermissionRoute>} />
            <Route path="/api-clients" element={<PermissionRoute permission="api-client:read"><ApiClientsPage /></PermissionRoute>} />
            <Route path="/api-keys" element={<Navigate to="/api-clients" replace />} />
            {/* 计费与成本路由 */}
            <Route path="/billing/records" element={<PermissionRoute permission="billing:read"><BillingRecordsPage /></PermissionRoute>} />
            <Route path="/billing/wallets" element={<PermissionRoute permission="billing:read"><WalletManagementPage /></PermissionRoute>} />
            <Route path="/link-conversion-config" element={<PermissionRoute permission="link-conversion:read"><LinkConversionConfigPage /></PermissionRoute>} />
            <Route path="/stats" element={<PermissionRoute permission="stats:read"><StatsPage /></PermissionRoute>} />
            <Route path="/audit-logs" element={<PermissionRoute permission="audit:read"><AuditLogsPage /></PermissionRoute>} />
            <Route path="/notification-rules" element={<PermissionRoute permission="notification:read"><NotificationRulesPage /></PermissionRoute>} />
            <Route path="/notification-records" element={<PermissionRoute permission="notification:read"><NotificationRecordsPage /></PermissionRoute>} />
            <Route path="/notifications" element={<PermissionRoute permission="notification:read"><InAppNotificationsPage /></PermissionRoute>} />
            <Route path="/callback-logs" element={<PermissionRoute permission="callback-log:read"><CallbackLogsPage /></PermissionRoute>} />
            <Route path="/system-info" element={<PermissionRoute permission="system:read"><SystemInfoPage /></PermissionRoute>} />
            <Route path="/users" element={<PermissionRoute permission="user:read"><UsersPage /></PermissionRoute>} />
            <Route path="/roles" element={<PermissionRoute permission="role:read"><RolesPage /></PermissionRoute>} />
            <Route path="/permissions" element={<PermissionRoute permission="permission:read"><PermissionsPage /></PermissionRoute>} />
            <Route path="/menus" element={<PermissionRoute permission="menu:read"><MenusPage /></PermissionRoute>} />
            <Route path="/forbidden" element={<ForbiddenPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
          </div>
        </Content>
      </Layout>
      <ChangePasswordModal open={changePwdOpen} onClose={() => setChangePwdOpen(false)} />
    </Layout>
  );
}

/**
 * 已登录用户访问 /login 时自动重定向到首页，
 * 避免每次打开 http://localhost:7003/login 都要重新登录
 */
function GuestGuard({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (isAuthenticated) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  const themeMode = useThemeStore((s) => s.mode);
  return (
    <ConfigProvider locale={zhCN} theme={buildAntdTheme(themeMode)}>
      <Routes>
        <Route path="/login" element={<GuestGuard><LoginPage /></GuestGuard>} />
        <Route path="/*" element={<AuthGuard><AppLayout /></AuthGuard>} />
      </Routes>
    </ConfigProvider>
  );
}
