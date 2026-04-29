import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Typography, Avatar, Dropdown, theme, Modal, Form, Input, message, Spin } from 'antd';
import {
  DashboardOutlined, UnorderedListOutlined, CloudServerOutlined,
  BarChartOutlined, AuditOutlined, UserOutlined, LogoutOutlined,
  AppstoreOutlined, KeyOutlined, BranchesOutlined, ApiOutlined,
  TeamOutlined, SafetyOutlined, LockOutlined, WalletOutlined,
  ClusterOutlined, BellOutlined, FileTextOutlined, NotificationOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useAuthStore } from './store/auth';
import { useMenuStore, type MenuGroup, type MenuItem } from './store/menu';
import { userApi } from './services/api';
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

const { Header, Sider, Content } = Layout;

// 图标名称字符串 → React 组件映射表
// 后端菜单 API 返回图标名称字符串，前端通过此映射表转换为实际组件
const iconMap: Record<string, React.ReactNode> = {
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
};

/** 解析图标名称为 React 组件，未匹配时使用默认图标 */
function resolveIcon(iconName?: string): React.ReactNode {
  if (!iconName) return undefined;
  return iconMap[iconName] ?? <AppstoreOutlined />;
}

/**
 * 将后端返回的 MenuGroup[] 转换为 Ant Design Menu 组件的 items 格式
 * 一级菜单作为 SubMenu，二级菜单作为 Menu.Item
 * 特殊情况：仅有一个子项的分组会被扁平化为单个菜单项
 */
function buildAntdMenuItems(groups: MenuGroup[]) {
  return groups.map((group) => {
    // 单子项分组：扁平化显示，避免不必要的 SubMenu 嵌套
    if (group.children.length === 1 && group.children[0].path) {
      const child = group.children[0];
      return {
        key: child.path!,
        icon: resolveIcon(child.icon || group.icon),
        label: child.label,
      };
    }
    // 多子项分组 → 渲染为 SubMenu（一级菜单），子项为 Menu.Item（二级菜单）
    return {
      key: `group-${group.key}`,
      icon: resolveIcon(group.icon),
      label: group.label,
      children: group.children.map((item: MenuItem) => ({
        key: item.path || item.key,
        icon: resolveIcon(item.icon),
        label: item.label,
      })),
    };
  });
}

/** 根据当前路径查找选中的菜单项 key */
function findSelectedKey(groups: MenuGroup[], pathname: string): string[] {
  for (const group of groups) {
    for (const child of group.children) {
      if (child.path && child.path !== '/' && pathname.startsWith(child.path)) {
        return [child.path];
      }
    }
  }
  return ['/'];
}

/** 根据当前路径查找需要展开的 SubMenu key */
function findOpenKeys(groups: MenuGroup[], pathname: string): string[] {
  for (const group of groups) {
    for (const child of group.children) {
      if (child.path && child.path !== '/' && pathname.startsWith(child.path)) {
        return [`group-${group.key}`];
      }
    }
  }
  return [];
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
  const { menuGroups, loading: menuLoading, fetchMenu } = useMenuStore();
  const { token: { colorBgContainer, borderRadiusLG } } = theme.useToken();
  const [changePwdOpen, setChangePwdOpen] = useState(false);

  useEffect(() => {
    fetchMenu();
  }, [fetchMenu]);

  const antdMenuItems = buildAntdMenuItems(menuGroups);
  const selectedKeys = findSelectedKey(menuGroups, location.pathname);
  const defaultOpenKeys = findOpenKeys(menuGroups, location.pathname);

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={220} theme="dark" breakpoint="lg" collapsedWidth={60}>
        <div style={{ height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid rgba(255,255,255,.1)' }}>
          <Typography.Title level={5} style={{ color: '#fff', margin: 0, whiteSpace: 'nowrap' }}>
            Model-Hub
          </Typography.Title>
        </div>
        {menuLoading ? (
          <div style={{ textAlign: 'center', padding: 24 }}><Spin size="small" /></div>
        ) : (
          <Menu
            theme="dark" mode="inline"
            selectedKeys={selectedKeys}
            defaultOpenKeys={defaultOpenKeys}
            items={antdMenuItems}
            onClick={({ key }) => {
              if (!key.startsWith('group-')) navigate(key);
            }}
          />
        )}
      </Sider>
      <Layout>
        <Header style={{ padding: '0 24px', background: colorBgContainer, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f0f0f0' }}>
          <Typography.Text strong>管理后台</Typography.Text>
          <Dropdown menu={{
            items: [
              { key: 'user', label: username || 'admin', icon: <UserOutlined />, disabled: true },
              { type: 'divider' },
              { key: 'change-password', label: '修改密码', icon: <LockOutlined />,
                onClick: () => setChangePwdOpen(true),
              },
              { key: 'logout', label: '退出登录', icon: <LogoutOutlined />, danger: true,
                onClick: () => { logout(); navigate('/login'); },
              },
            ],
          }}>
            <Avatar icon={<UserOutlined />} style={{ cursor: 'pointer', backgroundColor: '#1677ff' }} />
          </Dropdown>
        </Header>
        <Content style={{ margin: 24, padding: 24, background: colorBgContainer, borderRadius: borderRadiusLG, minHeight: 360 }}>
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
            <Route path="/account-pool" element={<PermissionRoute permission="provider:read"><AccountPoolPage /></PermissionRoute>} />
            <Route path="/account-costs" element={<PermissionRoute permission="provider:read"><AccountCostPage /></PermissionRoute>} />
            <Route path="/api-clients" element={<PermissionRoute permission="api-client:read"><ApiClientsPage /></PermissionRoute>} />
            <Route path="/stats" element={<PermissionRoute permission="stats:read"><StatsPage /></PermissionRoute>} />
            <Route path="/audit-logs" element={<PermissionRoute permission="audit:read"><AuditLogsPage /></PermissionRoute>} />
            <Route path="/notification-rules" element={<PermissionRoute permission="notification-rule:read"><NotificationRulesPage /></PermissionRoute>} />
            <Route path="/notification-records" element={<PermissionRoute permission="notification-record:read"><NotificationRecordsPage /></PermissionRoute>} />
            <Route path="/notifications" element={<InAppNotificationsPage />} />
            <Route path="/users" element={<PermissionRoute permission="user:read"><UsersPage /></PermissionRoute>} />
            <Route path="/roles" element={<PermissionRoute permission="role:read"><RolesPage /></PermissionRoute>} />
            <Route path="/permissions" element={<PermissionRoute permission="permission:read"><PermissionsPage /></PermissionRoute>} />
            <Route path="/forbidden" element={<ForbiddenPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
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
  return (
    <Routes>
      <Route path="/login" element={<GuestGuard><LoginPage /></GuestGuard>} />
      <Route path="/*" element={<AuthGuard><AppLayout /></AuthGuard>} />
    </Routes>
  );
}
