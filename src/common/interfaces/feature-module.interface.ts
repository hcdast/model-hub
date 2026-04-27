/**
 * 功能模块权限定义
 */
export interface FeaturePermissionDef {
  /** 资源名称，如 'notification-rule' */
  resource: string;
  /** 操作列表，如 ['read', 'create', 'update', 'delete'] */
  actions: string[];
  /** action → 中文名映射 */
  displayNames: Record<string, string>;
  /** 所属模块，如 'notification-management' */
  module: string;
}

/**
 * 功能模块菜单定义
 */
export interface FeatureMenuDef {
  /** 路由路径 */
  path: string;
  /** 菜单显示名称 */
  label: string;
  /** Ant Design 图标名称 */
  icon: string;
  /** 父级菜单分组 key */
  parentKey?: string;
  /** 排序权重（越小越靠前） */
  sortOrder: number;
  /** 所需权限代码（resource:read） */
  requiredPermission?: string;
}

/**
 * 功能模块审计定义
 */
export interface FeatureAuditDef {
  /** 控制器类名 */
  controllerName: string;
  /** 审计资源类型 */
  resourceType: string;
  /** 需要额外审计的 GET 方法名 */
  auditGetActions?: string[];
}

/**
 * 功能模块文档定义
 */
export interface FeatureDocDef {
  /** 文档章节 */
  section: 'architecture' | 'technical-design';
  /** 标题 */
  title: string;
  /** 描述 */
  description: string;
}

/**
 * 功能模块描述符
 */
export interface FeatureModuleDescriptor {
  /** 唯一标识，kebab-case 格式 */
  moduleKey: string;
  /** 中文显示名称 */
  displayName: string;
  /** 权限定义列表 */
  permissions?: FeaturePermissionDef[];
  /** 菜单配置 */
  menus?: FeatureMenuDef[];
  /** 审计操作列表 */
  audit?: FeatureAuditDef[];
  /** 文档元数据 */
  docs?: FeatureDocDef[];
}
