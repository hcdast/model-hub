import axios from 'axios';

const api = axios.create({ baseURL: '/api/v1/admin', timeout: 15000 });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res.data,
  (err) => {
    if (err.response?.status === 401) {
      // 清除所有认证相关的 localStorage 数据，保持与 auth store 一致
      localStorage.removeItem('token');
      localStorage.removeItem('username');
      localStorage.removeItem('roles');
      localStorage.removeItem('permissions');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  },
);

export const authApi = {
  login: (username: string, password: string) =>
    api.post('/auth/login', { username, password }),
};

export const menuApi = {
  getMenuTree: () => api.get('/menu'),
};

export const overviewApi = {
  getOverview: () => api.get('/overview'),
  getCostOverview: () => api.get('/cost-overview'),
};

export const taskApi = {
  list: (params: Record<string, any>) => api.get('/tasks', { params }),
  get: (taskId: string, params?: { refreshResourceMetadata?: string }) =>
    api.get(`/tasks/${taskId}`, { params }),
  getTimeline: (taskId: string) => api.get(`/tasks/${taskId}/timeline`),
  getTiming: (taskId: string) => api.get(`/tasks/${taskId}/timing`),
  replayCallback: (taskId: string) => api.post(`/tasks/${taskId}/replay-callback`),
  cancel: (taskId: string) => api.post(`/tasks/${taskId}/cancel`),
  updatePriority: (taskId: string, priority: number) =>
    api.put(`/tasks/${taskId}/priority`, { priority }),
};

export const queueApi = {
  getStats: () => api.get('/queues/stats'),
  getHistory: (queueName: string, from: string, to: string) =>
    api.get('/queues/stats/history', { params: { queueName, from, to } }),
  getJobs: (queueName: string, params?: { status?: 'waiting' | 'active'; page?: number; pageSize?: number }) =>
    api.get(`/queues/${encodeURIComponent(queueName)}/jobs`, { params }),
};

export const statsApi = {
  daily: (params: Record<string, any>) => api.get('/stats/daily', { params }),
};

export const auditApi = {
  list: (params: Record<string, any>) => api.get('/audit-logs', { params }),
};

export const modelApi = {
  list: (params: Record<string, any>) => api.get('/models', { params }),
  getDetail: (modelName: string) =>
    api.get('/models/detail', { params: { model_name: modelName } }),
  /** 获取模型在各厂商的定价信息（用于成本优先路由规则） */
  getProviderPricing: (modelName: string) =>
    api.get('/models/provider-pricing', { params: { model_name: modelName } }),
  toggle: (model_name: string, disabled: boolean) =>
    api.put('/models/toggle', { model_name, disabled }),
  getTemplates: () => api.get('/models/templates'),
  create: (data: Record<string, any>) => api.post('/models', data),
  update: (id: string, data: Record<string, any>) => api.put(`/models/${encodeURIComponent(id)}`, data),
  updatePricing: (id: string, unitPriceMap: Record<string, any>) =>
    api.put(`/models/${encodeURIComponent(id)}/pricing`, { unit_price_map: unitPriceMap }),
};

/** 模型路由规则（fixed / weighted / primary_fallback），对接 AdminModelRoutingController */
export const modelRoutingApi = {
  list: (params: Record<string, any>) => api.get('/model-routing-rules', { params }),
  create: (body: Record<string, unknown>) => api.post('/model-routing-rules', body),
  update: (id: string, body: Record<string, unknown>) => api.put(`/model-routing-rules/${id}`, body),
  remove: (id: string) => api.delete(`/model-routing-rules/${id}`),
  /** 路由仿真：规则命中 + model_configs 兜底，不写指标 */
  simulate: (body: Record<string, unknown>) => api.post('/model-routing-rules/simulate', body),
};

// ---- 厂商运行时配置类型（精简后，不再包含密钥字段） ----
export interface ProviderConfigItem {
  provider_name: string;
  enabled: boolean;
  icon_url: string;
  base_url: string;
  limits: { maxConcurrent?: number; maxPerSecond?: number; maxPerMinute?: number };
  poll_limits: { max_per_second?: number; max_concurrent?: number };
  revision: number;
  extra?: Record<string, unknown>;
  updatedAt?: string;
  // 已移除: api_key_masked, has_api_key — 密钥统一在账号池管理
}

/** 厂商运行时配置（Mongo provider_runtime_configs），密钥已移至账号池 */
export const providerConfigApi = {
  list: () => api.get('/provider-configs'),
  get: (providerName: string) =>
    api.get(`/provider-configs/${encodeURIComponent(providerName)}`),
  upsert: (providerName: string, body: Record<string, unknown>) =>
    api.put(`/provider-configs/${encodeURIComponent(providerName)}`, body),
};

export const apiClientApi = {
  list: (params: Record<string, any>) => api.get('/api-clients', { params }),
  create: (data: { name?: string }) => api.post('/api-clients', data),
  setEnabled: (clientId: string, enabled: boolean) =>
    api.patch(`/api-clients/${encodeURIComponent(clientId)}`, { enabled }),
  rotate: (clientId: string) => api.post(`/api-clients/${encodeURIComponent(clientId)}/rotate`),
  updateDefaultPriority: (clientId: string, defaultPriority: number) =>
    api.patch(`/api-clients/${encodeURIComponent(clientId)}/priority`, { defaultPriority }),
  /** 修改 API 客户端计费策略 */
  updateBillingPolicy: (clientId: string, billingPolicy: string) =>
    api.patch(`/api-clients/${encodeURIComponent(clientId)}/billing-policy`, { billingPolicy }),
  /** 更新限流配置 */
  updateRateLimits: (clientId: string, rateLimits: { maxQps?: number; maxConcurrent?: number; maxDailyRequests?: number }) =>
    api.put(`/api-clients/${encodeURIComponent(clientId)}/rate-limits`, rateLimits),
  /** 更新模型白名单 */
  updateModelAllowlist: (clientId: string, modelAllowlist: string[]) =>
    api.put(`/api-clients/${encodeURIComponent(clientId)}/model-allowlist`, { modelAllowlist }),
  /** 查询单个客户端用量统计 */
  getUsage: (clientId: string, params: { from?: string; to?: string }) =>
    api.get(`/api-clients/${encodeURIComponent(clientId)}/usage`, { params }),
  /** 查询所有客户端用量汇总 */
  getUsageSummary: () => api.get('/api-clients/usage/summary'),
};

// ---- 账号池条目类型（增强后，新增 extra_credentials 和 description） ----
export interface AccountPoolEntryItem {
  _id: string;
  provider_name: string;
  account_alias: string;
  api_key: string;
  base_url?: string;
  extra_credentials?: Record<string, unknown>;
  description?: string;
  weight: number;
  enabled: boolean;
  health_status: string;
  daily_cost_limit: number;
  monthly_cost_limit: number;
  tags: string[];
  metadata: Record<string, unknown>;
  revision: number;
  createdAt?: string;
  updatedAt?: string;
}

// ---- 账号池管理 API ----
export const accountPoolApi = {
  list: (params: Record<string, any>) => api.get('/account-pool', { params }),
  detail: (id: string) => api.get(`/account-pool/${id}`),
  create: (data: Record<string, any>) => api.post('/account-pool', data),
  update: (id: string, data: Record<string, any>) => api.put(`/account-pool/${id}`, data),
  remove: (id: string) => api.delete(`/account-pool/${id}`),
};

// ---- 账号成本 API ----
export const accountCostApi = {
  listDaily: (params: Record<string, any>) => api.get('/account-costs', { params }),
  monthly: (params: Record<string, any>) => api.get('/account-costs/monthly', { params }),
};

// ---- RBAC 用户管理 API ----
export const userApi = {
  list: (params: Record<string, any>) => api.get('/users', { params }),
  get: (id: string) => api.get(`/users/${id}`),
  create: (data: Record<string, any>) => api.post('/users', data),
  update: (id: string, data: Record<string, any>) => api.put(`/users/${id}`, data),
  delete: (id: string) => api.delete(`/users/${id}`),
  toggleStatus: (id: string, enabled: boolean) =>
    api.put(`/users/${id}/status`, { enabled }),
  assignRoles: (id: string, roles: string[]) =>
    api.put(`/users/${id}/roles`, { roles }),
  changePassword: (id: string, data: { oldPassword: string; newPassword: string }) =>
    api.put(`/users/${id}/password`, data),
  resetPassword: (id: string) => api.post(`/users/${id}/reset-password`),
};

// ---- RBAC 角色管理 API ----
export const roleApi = {
  list: () => api.get('/roles'),
  get: (name: string) => api.get(`/roles/${name}`),
  create: (data: Record<string, any>) => api.post('/roles', data),
  update: (name: string, data: Record<string, any>) => api.put(`/roles/${name}`, data),
  delete: (name: string) => api.delete(`/roles/${name}`),
  assignPermissions: (name: string, permissions: string[]) =>
    api.put(`/roles/${name}/permissions`, { permissions }),
  checkInUse: (name: string) => api.get(`/roles/${name}/in-use`),
};

// ---- RBAC 权限管理 API ----
export const permissionApi = {
  list: (params?: { module?: string }) => api.get('/permissions', { params }),
  listModules: () => api.get('/permissions/modules'),
};

// ---- 通知规则 API ----
export const notificationRuleApi = {
  list: (params?: Record<string, any>) => api.get('/notification-rules', { params }),
  get: (id: string) => api.get(`/notification-rules/${id}`),
  create: (data: Record<string, any>) => api.post('/notification-rules', data),
  update: (id: string, data: Record<string, any>) => api.put(`/notification-rules/${id}`, data),
  delete: (id: string) => api.delete(`/notification-rules/${id}`),
};

// ---- 通知记录 API ----
export const notificationRecordApi = {
  list: (params: Record<string, any>) => api.get('/notification-records', { params }),
};

// ---- 站内通知 API ----
export const inAppNotificationApi = {
  list: (params: Record<string, any>) => api.get('/notifications', { params }),
  markRead: (id: string) => api.put(`/notifications/${id}/read`),
  markAllRead: () => api.put('/notifications/read-all'),
  unreadCount: () => api.get('/notifications/unread-count'),
};

/** 第三方链接转换配置（与后端 config 字段结构一致，snake_case） */
export interface LinkConversionConfigPayload {
  enabled: boolean;
  timeout: {
    download_ms: number;
    upload_ms: number;
    total_ms: number;
  };
  domain_whitelist: string[];
  resource_filters: {
    allowed_types: string[];
    max_size_bytes: {
      image: number;
      video: number;
      audio: number;
    };
  };
  storage_config: {
    bucket: string;
    path_prefix: string;
    biz_type?: string;
  };
  storagesvc: {
    host: string;
    jwt_secret: string;
    timeout_ms?: number;
    resilience?: Record<string, unknown>;
    cdn_domain_list?: string[];
    jwt_user_id_prefix?: string;
    jwt_issuer?: string;
    jwt_expires_in?: string;
  };
  failure_policy: 'fail_fast' | 'use_original';
  retry_config: {
    max_attempts: number;
    backoff_factor: number;
    initial_delay_ms: number;
  };
  monitoring: {
    failure_rate_threshold: number;
    alert_channels: string[];
    alert_recipients: string[];
  };
}

export const callbackLogApi = {
  list: (params: Record<string, any>) => api.get('/callback-logs', { params }),
};

export const systemInfoApi = {
  get: () => api.get('/system-info'),
};

export const linkConversionConfigApi = {
  get: (params?: { fresh?: boolean }) =>
    api.get('/link-conversion-config', {
      params: params?.fresh ? { fresh: '1' } : undefined,
    }),
  update: (body: LinkConversionConfigPayload) =>
    api.put('/link-conversion-config', body),
};

export default api;
