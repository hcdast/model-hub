import { create } from 'zustand';
import { menuApi } from '../services/api';

/**
 * 菜单项接口
 * 对应后端 MenuRegistryService 返回的二级菜单结构
 */
export interface MenuItem {
  /** 菜单项唯一标识 */
  key: string;
  /** 路由路径 */
  path?: string;
  /** 菜单显示名称 */
  label: string;
  /** Ant Design 图标名称 */
  icon: string;
  /** 排序权重，越小越靠前 */
  sortOrder: number;
  /** 父级菜单分组 key */
  parentKey?: string;
  /** 所需权限代码，如 "task:read" */
  requiredPermission?: string;
  /** 子菜单项（预留多级菜单扩展） */
  children?: MenuItem[];
}

/**
 * 菜单分组接口
 * 对应后端返回的一级菜单（SubMenu）结构
 */
export interface MenuGroup {
  /** 分组唯一标识 */
  key: string;
  /** 分组显示名称 */
  label: string;
  /** Ant Design 图标名称 */
  icon: string;
  /** 排序权重，越小越靠前 */
  sortOrder: number;
  /** 分组下的二级菜单项 */
  children: MenuItem[];
}

/**
 * 降级菜单配置
 * 当后端菜单 API 请求失败时，仅显示总览页面
 * 确保用户在异常情况下仍可访问基础功能
 */
const FALLBACK_MENU: MenuGroup[] = [
  {
    key: 'overview',
    label: '系统总览',
    icon: 'DashboardOutlined',
    sortOrder: 0,
    children: [
      { key: 'dashboard', path: '/', label: '总览', icon: 'DashboardOutlined', sortOrder: 0 },
    ],
  },
];

/** 菜单状态接口 */
interface MenuState {
  /** 菜单分组列表（从后端 API 动态获取） */
  menuGroups: MenuGroup[];
  /** 菜单数据加载中标志 */
  loading: boolean;
  /** 菜单加载失败标志 */
  error: boolean;
  /** 从后端获取菜单配置，失败时降级为基础菜单 */
  fetchMenu: () => Promise<void>;
  /** 重置菜单状态 */
  reset: () => void;
}

/**
 * 菜单状态 Store
 * 通过 GET /api/v1/admin/menu 从后端动态获取菜单配置
 * 替代前端硬编码的 menuItems，实现菜单的动态管理
 */
export const useMenuStore = create<MenuState>((set) => ({
  menuGroups: [],
  loading: false,
  error: false,
  fetchMenu: async () => {
    set({ loading: true, error: false });
    try {
      // 调用后端菜单 API，获取当前用户权限过滤后的菜单树
      const res: any = await menuApi.getMenuTree();
      const groups = res.data ?? res ?? [];
      set({ menuGroups: Array.isArray(groups) ? groups : [], loading: false });
    } catch {
      // 加载失败时降级为基础菜单（仅总览），确保基本可用性
      set({ menuGroups: FALLBACK_MENU, loading: false, error: true });
    }
  },
  reset: () => set({ menuGroups: [], loading: false, error: false }),
}));
