/**
 * 将审计日志中的 action（Controller.method 或自定义字符串）转为中文说明。
 * 未知项仍返回可读拼接，并在需要处由调用方用 Tooltip 展示原始 action。
 */

/** 无「Controller.」形式的固定 action */
const EXACT_ACTION_ZH: Record<string, string> = {
  REPLAY_CALLBACK: '任务 · 重放回调',
  CANCEL_TASK: '任务 · 取消',
  UPDATE_TASK_PRIORITY: '任务 · 调整优先级',
  'account_pool.create': '账号池 · 创建账号',
  'account_pool.update': '账号池 · 更新账号',
  'account_pool.delete': '账号池 · 删除账号',
  'provider_runtime_config.upsert': '供应商配置 · 更新运行时参数',
  'provider_runtime_config.update_cost_config': '供应商配置 · 更新成本配置',
  'link_conversion_config.replace': '请求转换 · 全量更新配置',
};

/** Controller 类名（不含 Controller 后缀，与拦截器里一致）→ 中文模块名 */
const CONTROLLER_ZH: Record<string, string> = {
  AdminApiClient: '应用与 API 密钥',
  AdminAuth: '认证',
  AdminBilling: '计费与成本',
  AdminTask: '任务',
  AdminModelConfig: '模型配置',
  AdminModelRouting: '模型路由',
  AdminProviderConfig: '供应商配置',
  AdminAccountPool: '账号池',
  AdminAccountCost: '成本分析',
  AdminStats: '统计',
  AdminMenu: '侧栏菜单',
  AdminAudit: '审计日志',
  AdminCallbackLogs: '回调日志',
  AdminSystemInfo: '系统信息',
  AdminLinkConversionConfig: '请求转换',
  ProviderHealth: '供应商健康度',
  UserManagement: '用户管理',
  RoleManagement: '角色管理',
  PermissionManagement: '权限管理',
  MenuManagement: '菜单配置',
};

/** 方法名 → 中文动词/说明 */
const METHOD_ZH: Record<string, string> = {
  create: '创建',
  update: '更新',
  delete: '删除',
  remove: '删除',
  list: '列表查询',
  listAll: '扁平列表查询',
  getTree: '树形查询',
  getByKey: '按标识查询',
  get: '查询',
  getMenuTree: '获取菜单树',
  detail: '详情查询',
  listRecords: '用量账单列表',
  getSummary: '计费汇总',
  listWallets: '钱包列表',
  getWallet: '钱包余额',
  listTransactions: '钱包流水',
  creditWallet: '手动充值',
  createClient: '创建',
  patchEnabled: '启用/禁用',
  rotate: '轮换密钥',
  updateDefaultPriority: '更新默认优先级',
  updateBillingPolicy: '更新计费策略',
  updateRateLimits: '更新限流',
  updateModelAllowlist: '更新模型白名单',
  getUsageSummary: '用量汇总',
  getUsage: '用量明细',
  listTasks: '任务列表',
  getTask: '任务详情',
  getTimeline: '任务时间线',
  getTiming: '任务耗时',
  replayCallback: '重放回调',
  adminCancelTask: '取消任务',
  updatePriority: '调整优先级',
  login: '登录',
  logout: '登出',
  listLogs: '查询审计列表',
  getResourceTypes: '审计资源类型列表',
  listUsers: '用户列表',
  createUser: '创建用户',
  getUserById: '用户详情',
  updateUser: '更新用户',
  deleteUser: '删除用户',
  toggleUserStatus: '切换用户状态',
  assignRoles: '分配角色',
  changePassword: '修改密码',
  resetPassword: '重置密码',
  createRole: '创建角色',
  listRoles: '角色列表',
  getRoleByName: '角色详情',
  updateRole: '更新角色',
  deleteRole: '删除角色',
  assignPermissions: '分配权限',
  assignMenus: '分配菜单',
  checkRoleInUse: '检查角色占用',
  registerPermission: '注册权限',
  registerPermissions: '批量注册权限',
  listPermissions: '权限列表',
  listModules: '模块列表',
  getPermissionByCode: '按代码查权限',
  upsert: '保存/更新',
  updateCostConfig: '更新成本配置',
  simulate: '路由模拟',
  toggle: '启用/禁用模型',
  getTemplates: '模板列表',
  updatePricing: '更新定价',
  getProviderPricing: '厂商定价查询',
  put: '全量更新',
  getDailyStats: '日统计',
  getQueueStats: '队列统计',
  getQueueHistory: '队列历史',
  getOverview: '总览',
  getCostOverview: '成本总览',
  getQueueJobs: '队列任务列表',
  listDaily: '日成本列表',
  monthlyAggregate: '月成本汇总',
  overrideCircuitBreaker: '熔断手动覆盖',
  clearOverride: '清除熔断覆盖',
  updateConfig: '更新熔断配置',
  getConfig: '查询熔断配置',
  getProviderHealth: '供应商健康度详情',
  getHistory: '健康历史',
};

function humanizeUnknownMethod(method: string): string {
  if (!method) return '未知操作';
  const spaced = method.replace(/([a-z])([A-Z])/g, '$1 $2');
  return spaced;
}

/**
 * @returns 中文说明；若无映射则「模块 · 方法」形式
 */
export function describeAuditActionZh(action: string | undefined | null): string {
  if (action == null || String(action).trim() === '') return '—';
  const raw = String(action).trim();

  const exact = EXACT_ACTION_ZH[raw];
  if (exact) return exact;

  const dot = raw.lastIndexOf('.');
  if (dot <= 0 || dot === raw.length - 1) {
    return raw;
  }

  const ctrl = raw.slice(0, dot);
  const method = raw.slice(dot + 1);
  const ctrlZh = CONTROLLER_ZH[ctrl] || ctrl.replace(/^Admin/, '管理端 · ');
  const methodZh = METHOD_ZH[method] || humanizeUnknownMethod(method);
  return `${ctrlZh} · ${methodZh}`;
}
