/**
 * 现有模块的 Feature Module Descriptors
 * 从 RbacInitializationService 中的硬编码权限列表迁移而来
 */
import { FeatureModuleDescriptor } from '../interfaces/feature-module.interface';

export const overviewDescriptor: FeatureModuleDescriptor = {
  moduleKey: 'overview',
  displayName: '系统总览',
  menus: [
    {
      path: '/',
      label: '总览',
      icon: 'DashboardOutlined',
      parentKey: 'overview',
      sortOrder: 0,
    },
  ],
};

export const userDescriptor: FeatureModuleDescriptor = {
  moduleKey: 'user',
  displayName: '用户管理',
  permissions: [
    {
      resource: 'user',
      actions: ['read', 'create', 'update', 'delete'],
      displayNames: {
        read: '查看用户',
        create: '创建用户',
        update: '更新用户',
        delete: '删除用户',
      },
      module: 'user-management',
    },
  ],
  menus: [
    {
      path: '/users',
      label: '用户管理',
      icon: 'UserOutlined',
      parentKey: 'access',
      sortOrder: 20,
      requiredPermission: 'user:read',
    },
  ],
};

export const roleDescriptor: FeatureModuleDescriptor = {
  moduleKey: 'role',
  displayName: '角色管理',
  permissions: [
    {
      resource: 'role',
      actions: ['read', 'create', 'update', 'delete'],
      displayNames: {
        read: '查看角色',
        create: '创建角色',
        update: '更新角色',
        delete: '删除角色',
      },
      module: 'role-management',
    },
  ],
  menus: [
    {
      path: '/roles',
      label: '角色管理',
      icon: 'TeamOutlined',
      parentKey: 'access',
      sortOrder: 30,
      requiredPermission: 'role:read',
    },
  ],
};

export const permissionDescriptor: FeatureModuleDescriptor = {
  moduleKey: 'permission',
  displayName: '权限管理',
  permissions: [
    {
      resource: 'permission',
      actions: ['read', 'create'],
      displayNames: {
        read: '查看权限',
        create: '创建权限',
      },
      module: 'permission-management',
    },
  ],
  menus: [
    {
      path: '/permissions',
      label: '权限管理',
      icon: 'KeyOutlined',
      parentKey: 'access',
      sortOrder: 40,
      requiredPermission: 'permission:read',
    },
  ],
};

export const modelDescriptor: FeatureModuleDescriptor = {
  moduleKey: 'model',
  displayName: '模型配置',
  permissions: [
    {
      resource: 'model',
      actions: ['read', 'create', 'update', 'delete'],
      displayNames: {
        read: '查看模型配置',
        create: '创建模型配置',
        update: '更新模型配置',
        delete: '删除模型配置',
      },
      module: 'model-management',
    },
  ],
  menus: [
    {
      path: '/models',
      label: '模型配置',
      icon: 'AppstoreOutlined',
      parentKey: 'business',
      sortOrder: 30,
      requiredPermission: 'model:read',
    },
    {
      path: '/model-routing-rules',
      label: '路由规则',
      icon: 'BranchesOutlined',
      parentKey: 'business',
      sortOrder: 40,
      requiredPermission: 'model:read',
    },
  ],
};

export const taskDescriptor: FeatureModuleDescriptor = {
  moduleKey: 'task',
  displayName: '任务管理',
  permissions: [
    {
      resource: 'task',
      actions: ['read', 'create', 'update', 'delete'],
      displayNames: {
        read: '查看任务',
        create: '创建任务',
        update: '更新任务',
        delete: '删除任务',
      },
      module: 'task-management',
    },
  ],
  menus: [
    {
      path: '/tasks',
      label: '任务管理',
      icon: 'UnorderedListOutlined',
      parentKey: 'business',
      sortOrder: 10,
      requiredPermission: 'task:read',
    },
  ],
};

export const apiClientDescriptor: FeatureModuleDescriptor = {
  moduleKey: 'api-client',
  displayName: 'API客户端',
  permissions: [
    {
      resource: 'api-client',
      actions: ['read', 'create', 'update', 'delete'],
      displayNames: {
        read: '查看API客户端',
        create: '创建API客户端',
        update: '更新API客户端',
        delete: '删除API客户端',
      },
      module: 'api-client-management',
    },
  ],
  menus: [
    {
      path: '/api-clients',
      label: 'API 客户端',
      icon: 'ApiOutlined',
      parentKey: 'system',
      sortOrder: 10,
      requiredPermission: 'api-client:read',
    },
  ],
};

export const auditDescriptor: FeatureModuleDescriptor = {
  moduleKey: 'audit',
  displayName: '审计日志',
  permissions: [
    {
      resource: 'audit',
      actions: ['read'],
      displayNames: {
        read: '查看审计日志',
      },
      module: 'audit-management',
    },
  ],
  menus: [
    {
      path: '/audit-logs',
      label: '审计日志',
      icon: 'FileSearchOutlined',
      parentKey: 'audit',
      sortOrder: 10,
      requiredPermission: 'audit:read',
    },
  ],
};

export const statsDescriptor: FeatureModuleDescriptor = {
  moduleKey: 'stats',
  displayName: '统计数据',
  permissions: [
    {
      resource: 'stats',
      actions: ['read'],
      displayNames: {
        read: '查看统计数据',
      },
      module: 'stats-management',
    },
  ],
  menus: [
    {
      path: '/stats',
      label: '统计报表',
      icon: 'BarChartOutlined',
      parentKey: 'system',
      sortOrder: 20,
      requiredPermission: 'stats:read',
    },
  ],
};

export const queueDescriptor: FeatureModuleDescriptor = {
  moduleKey: 'queue',
  displayName: '队列管理',
  permissions: [
    {
      resource: 'queue',
      actions: ['read'],
      displayNames: {
        read: '查看队列',
      },
      module: 'queue-management',
    },
  ],
  menus: [
    {
      path: '/queues',
      label: '队列监控',
      icon: 'SyncOutlined',
      parentKey: 'business',
      sortOrder: 20,
      requiredPermission: 'queue:read',
    },
  ],
};

export const providerDescriptor: FeatureModuleDescriptor = {
  moduleKey: 'provider',
  displayName: '提供商配置',
  permissions: [
    {
      resource: 'provider',
      actions: ['read', 'create', 'update', 'delete'],
      displayNames: {
        read: '查看提供商配置',
        create: '创建提供商配置',
        update: '更新提供商配置',
        delete: '删除提供商配置',
      },
      module: 'provider-management',
    },
  ],
  menus: [
    {
      path: '/provider-configs',
      label: '厂商配置',
      icon: 'CloudServerOutlined',
      parentKey: 'provider',
      sortOrder: 10,
      requiredPermission: 'provider:read',
    },
    {
      path: '/account-pool',
      label: '账号池',
      icon: 'DatabaseOutlined',
      parentKey: 'provider',
      sortOrder: 20,
      requiredPermission: 'provider:read',
    },
    {
      path: '/account-costs',
      label: '成本观测',
      icon: 'DollarOutlined',
      parentKey: 'provider',
      sortOrder: 30,
      requiredPermission: 'provider:read',
    },
    {
      path: '/provider-health',
      label: 'Provider 健康',
      icon: 'HeartOutlined',
      parentKey: 'provider',
      sortOrder: 40,
      requiredPermission: 'provider:read',
    },
  ],
};

/** 通知管理（与 Notification*Controller 的 notification:* 权限一致） */
export const notificationDescriptor: FeatureModuleDescriptor = {
  moduleKey: 'notification',
  displayName: '通知管理',
  permissions: [
    {
      resource: 'notification',
      actions: ['read', 'create', 'update', 'delete'],
      displayNames: {
        read: '查看通知与规则',
        create: '创建通知规则',
        update: '更新通知与站内信',
        delete: '删除通知规则',
      },
      module: 'notification-management',
    },
  ],
  menus: [
    {
      path: '/notification-rules',
      label: '通知规则',
      icon: 'BellOutlined',
      parentKey: 'notification',
      sortOrder: 10,
      requiredPermission: 'notification:read',
    },
    {
      path: '/notification-records',
      label: '通知记录',
      icon: 'MailOutlined',
      parentKey: 'notification',
      sortOrder: 20,
      requiredPermission: 'notification:read',
    },
    {
      path: '/notifications',
      label: '站内通知',
      icon: 'NotificationOutlined',
      parentKey: 'notification',
      sortOrder: 30,
      requiredPermission: 'notification:read',
    },
  ],
};

/** 回调投递日志（Mongo callback_logs） */
export const callbackLogDescriptor: FeatureModuleDescriptor = {
  moduleKey: 'callback-log',
  displayName: '回调日志',
  permissions: [
    {
      resource: 'callback-log',
      actions: ['read'],
      displayNames: {
        read: '查看回调投递日志',
      },
      module: 'callback-log-management',
    },
  ],
  menus: [
    {
      path: '/callback-logs',
      label: '回调日志',
      icon: 'FileSearchOutlined',
      parentKey: 'audit',
      sortOrder: 15,
      requiredPermission: 'callback-log:read',
    },
  ],
};

/** 只读系统运行信息 */
export const systemInfoDescriptor: FeatureModuleDescriptor = {
  moduleKey: 'system-info',
  displayName: '系统信息',
  permissions: [
    {
      resource: 'system',
      actions: ['read'],
      displayNames: {
        read: '查看系统运行信息',
      },
      module: 'system-info-management',
    },
  ],
  menus: [
    {
      path: '/system-info',
      label: '系统信息',
      icon: 'ClusterOutlined',
      parentKey: 'system',
      sortOrder: 18,
      requiredPermission: 'system:read',
    },
  ],
};

/** 第三方链接转换配置（管理后台） */
export const linkConversionDescriptor: FeatureModuleDescriptor = {
  moduleKey: 'link-conversion',
  displayName: '链接转换配置',
  permissions: [
    {
      resource: 'link-conversion',
      actions: ['read', 'update'],
      displayNames: {
        read: '查看链接转换配置',
        update: '更新链接转换配置',
      },
      module: 'link-conversion-management',
    },
  ],
  menus: [
    {
      path: '/link-conversion-config',
      label: '链接转换配置',
      icon: 'LinkOutlined',
      parentKey: 'system',
      sortOrder: 25,
      requiredPermission: 'link-conversion:read',
    },
  ],
};

/** 计费管理模块描述符 */
export const billingDescriptor: FeatureModuleDescriptor = {
  moduleKey: 'billing',
  displayName: '计费管理',
  permissions: [
    {
      resource: 'billing',
      actions: ['read', 'write'],
      displayNames: {
        read: '查看计费信息',
        write: '管理计费（充值等）',
      },
      module: 'billing-management',
    },
  ],
  menus: [
    {
      path: '/billing/records',
      label: '计费记录',
      icon: 'FileTextOutlined',
      parentKey: 'billing',
      sortOrder: 10,
      requiredPermission: 'billing:read',
    },
    {
      path: '/billing/wallets',
      label: '钱包管理',
      icon: 'WalletOutlined',
      parentKey: 'billing',
      sortOrder: 20,
      requiredPermission: 'billing:read',
    },
  ],
};

/** 菜单管理模块描述符 */
export const menuDescriptor: FeatureModuleDescriptor = {
  moduleKey: 'menu',
  displayName: '菜单管理',
  permissions: [
    {
      resource: 'menu',
      actions: ['read', 'create', 'update', 'delete'],
      displayNames: {
        read: '查看菜单',
        create: '创建菜单',
        update: '更新菜单',
        delete: '删除菜单',
      },
      module: 'menu-management',
    },
  ],
  menus: [
    {
      path: '/menus',
      label: '菜单管理',
      icon: 'MenuOutlined',
      parentKey: 'system',
      sortOrder: 5,
      requiredPermission: 'menu:read',
    },
  ],
};

/** All built-in module descriptors */
export const builtInDescriptors: FeatureModuleDescriptor[] = [
  overviewDescriptor,
  userDescriptor,
  roleDescriptor,
  permissionDescriptor,
  modelDescriptor,
  taskDescriptor,
  apiClientDescriptor,
  auditDescriptor,
  statsDescriptor,
  queueDescriptor,
  providerDescriptor,
  notificationDescriptor,
  callbackLogDescriptor,
  systemInfoDescriptor,
  billingDescriptor,
  linkConversionDescriptor,
  menuDescriptor,
];
