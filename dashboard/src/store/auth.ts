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
  /** 用户授权菜单 key 列表 */
  menus: string[];
  isAuthenticated: boolean;
  /** 登录方法，接收 token、用户名、角色列表、权限列表和菜单列表 */
  login: (token: string, username: string, roles?: string[], permissions?: string[], menus?: string[]) => void;
  /** 登出方法，清除所有认证信息 */
  logout: () => void;
}

/**
 * 认证状态 Store
 * 使用 localStorage 持久化登录状态、角色和权限
 */
export const useAuthStore = create<AuthState>((set) => ({
  ...readSession(),
  login: (token, username, roles = [], permissions = [], menus = []) => {
    // 持久化到 localStorage
    localStorage.setItem('token', token);
    localStorage.setItem('username', username);
    localStorage.setItem('roles', JSON.stringify(roles));
    localStorage.setItem('permissions', JSON.stringify(permissions));
    localStorage.setItem('menus', JSON.stringify(menus));
    set({ token, username, roles, permissions, menus, isAuthenticated: true });
  },
  logout: () => {
    // 清除所有认证相关的 localStorage 数据
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    localStorage.removeItem('roles');
    localStorage.removeItem('permissions');
    localStorage.removeItem('menus');
    set({ token: null, username: null, roles: [], permissions: [], menus: [], isAuthenticated: false });
  },
}));

function readSession() {
  const empty = { token: null, username: null, roles: [], permissions: [], menus: [], isAuthenticated: false };
  try {
    const list = (key: string): string[] => {
      const value = JSON.parse(localStorage.getItem(key) || '[]');
      if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error('Invalid session');
      return value;
    };
    const token = localStorage.getItem('token');
    if (!token) return empty;
    return { token, username: localStorage.getItem('username'), roles: list('roles'), permissions: list('permissions'), menus: list('menus'), isAuthenticated: true };
  } catch {
    // Corrupted browser state must fail closed, while leaving the login page usable.
    try { ['token', 'username', 'roles', 'permissions', 'menus'].forEach(key => localStorage.removeItem(key)); } catch { /* unavailable storage */ }
    return empty;
  }
}

window.addEventListener('storage', event => {
  if (event.storageArea !== localStorage || (event.key !== null && !['token', 'username', 'roles', 'permissions', 'menus'].includes(event.key))) return;
  const previousToken = useAuthStore.getState().token;
  const session = readSession();
  useAuthStore.setState(session);
  // Switching accounts must discard data fetched for the previous account.
  if (previousToken && session.token && previousToken !== session.token) window.location.reload();
});
