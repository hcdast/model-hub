import { create } from 'zustand';

/**
 * 认证状态接口
 * 管理用户登录状态、角色和权限信息
 */
interface AuthState {
  token: string | null;
  username: string | null;
  /** 用户角色列表 */
  roles: string[];
  /** 用户权限列表，格式为 "resource:action"，如 "task:read" */
  permissions: string[];
  isAuthenticated: boolean;
  /** 登录方法，接收 token、用户名、角色列表和权限列表 */
  login: (token: string, username: string, roles?: string[], permissions?: string[]) => void;
  /** 登出方法，清除所有认证信息 */
  logout: () => void;
}

/**
 * 认证状态 Store
 * 使用 localStorage 持久化登录状态、角色和权限
 */
export const useAuthStore = create<AuthState>((set) => ({
  // 从 localStorage 恢复认证状态
  token: localStorage.getItem('token'),
  username: localStorage.getItem('username'),
  roles: JSON.parse(localStorage.getItem('roles') || '[]'),
  permissions: JSON.parse(localStorage.getItem('permissions') || '[]'),
  isAuthenticated: !!localStorage.getItem('token'),
  login: (token, username, roles = [], permissions = []) => {
    // 持久化到 localStorage
    localStorage.setItem('token', token);
    localStorage.setItem('username', username);
    localStorage.setItem('roles', JSON.stringify(roles));
    localStorage.setItem('permissions', JSON.stringify(permissions));
    set({ token, username, roles, permissions, isAuthenticated: true });
  },
  logout: () => {
    // 清除所有认证相关的 localStorage 数据
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    localStorage.removeItem('roles');
    localStorage.removeItem('permissions');
    set({ token: null, username: null, roles: [], permissions: [], isAuthenticated: false });
  },
}));
