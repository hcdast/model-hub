/**
 * Portal 用户角色权限配置
 * 定义每个角色的默认限制和权限
 */

export interface RolePermissions {
  /** 角色名称 */
  role: string;
  /** 显示名称 */
  displayName: string;
  /** 角色描述 */
  description: string;

  /** API Key 相关限制 */
  apiKey: {
    /** 最大 API Key 数量 */
    maxCount: number;
    /** 默认速率限制 (QPS) */
    defaultQps: number;
    /** 最大速率限制 (QPS) - 用户不能超过此值 */
    maxQps: number;
    /** 默认每日请求限额 */
    defaultDailyRequests: number;
    /** 最大每日请求限额 */
    maxDailyRequests: number;
  };

  /** 工作流相关限制 */
  workflow: {
    /** 最大工作流数量 */
    maxCount: number;
    /** 最大节点数 / 工作流 */
    maxNodesPerWorkflow: number;
    /** 最大并发执行数 */
    maxConcurrentRuns: number;
    /** 执行超时时间 (秒) */
    executionTimeout: number;
  };

  /** 模型访问权限 */
  models: {
    /** 可访问的模型列表 (空数组 = 全部) */
    allowedModels: string[];
    /** 是否可访问高级模型 */
    accessPremium: boolean;
  };

  /** 其他功能权限 */
  features: {
    /** 是否可创建私有模板 */
    canCreateTemplate: boolean;
    /** 是否可发布公开模板 */
    canPublishTemplate: boolean;
    /** 是否可使用条件分支 */
    canUseCondition: boolean;
    /** 是否可使用循环 */
    canUseLoop: boolean;
    /** 是否可使用自定义代码节点 */
    canUseCustomCode: boolean;
  };

  /** 执行优先级 (1-10, 10最高) */
  priority: number;
}

/**
 * 角色权限配置表
 */
export const ROLE_PERMISSIONS: Record<string, RolePermissions> = {
  user: {
    role: 'user',
    displayName: '普通用户',
    description: '基础功能，适合个人使用',

    apiKey: {
      maxCount: 3,
      defaultQps: 10,
      maxQps: 50,
      defaultDailyRequests: 1000,
      maxDailyRequests: 5000,
    },

    workflow: {
      maxCount: 10,
      maxNodesPerWorkflow: 10,
      maxConcurrentRuns: 2,
      executionTimeout: 300,  // 5 分钟
    },

    models: {
      allowedModels: [],  // 空数组表示使用系统默认
      accessPremium: false,
    },

    features: {
      canCreateTemplate: false,
      canPublishTemplate: false,
      canUseCondition: true,
      canUseLoop: false,
      canUseCustomCode: false,
    },

    priority: 3,
  },

  vip: {
    role: 'vip',
    displayName: 'VIP 用户',
    description: '扩展功能，适合专业用户',

    apiKey: {
      maxCount: 10,
      defaultQps: 50,
      maxQps: 200,
      defaultDailyRequests: 10000,
      maxDailyRequests: 50000,
    },

    workflow: {
      maxCount: 50,
      maxNodesPerWorkflow: 30,
      maxConcurrentRuns: 5,
      executionTimeout: 600,  // 10 分钟
    },

    models: {
      allowedModels: [],  // 可访问所有模型
      accessPremium: true,
    },

    features: {
      canCreateTemplate: true,
      canPublishTemplate: false,
      canUseCondition: true,
      canUseLoop: true,
      canUseCustomCode: false,
    },

    priority: 6,
  },

  admin: {
    role: 'admin',
    displayName: '管理员',
    description: '最高权限，无限制',

    apiKey: {
      maxCount: -1,  // -1 表示无限制
      defaultQps: 200,
      maxQps: -1,
      defaultDailyRequests: 100000,
      maxDailyRequests: -1,
    },

    workflow: {
      maxCount: -1,
      maxNodesPerWorkflow: -1,
      maxConcurrentRuns: 20,
      executionTimeout: 3600,  // 1 小时
    },

    models: {
      allowedModels: [],  // 可访问所有模型
      accessPremium: true,
    },

    features: {
      canCreateTemplate: true,
      canPublishTemplate: true,
      canUseCondition: true,
      canUseLoop: true,
      canUseCustomCode: true,
    },

    priority: 10,
  },
};

/**
 * 获取角色权限配置
 */
export function getRolePermissions(role: string): RolePermissions {
  return ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS['user'];
}

/**
 * 检查用户是否有权限执行某操作
 */
export function checkPermission(role: string, permission: keyof RolePermissions['features']): boolean {
  const perms = getRolePermissions(role);
  return perms.features[permission] === true;
}

/**
 * 获取用户的 API Key 限制
 */
export function getApiKeyLimits(role: string) {
  const perms = getRolePermissions(role);
  return perms.apiKey;
}

/**
 * 获取用户的工作流限制
 */
export function getWorkflowLimits(role: string) {
  const perms = getRolePermissions(role);
  return perms.workflow;
}
