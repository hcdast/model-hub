import { useAuthStore } from '../store/auth';

/**
 * 权限检查 Hook
 * 提供权限判断方法，用于前端权限控制
 * 支持单权限检查、多权限检查和通配符权限
 */
export function usePermission() {
  // 从认证 Store 获取当前用户的权限列表和角色列表
  const permissions = useAuthStore((s) => s.permissions);
  const roles = useAuthStore((s) => s.roles);

  // 判断是否为超级管理员（拥有所有权限）
  const isSuperAdmin = roles.includes('super_admin');

  /**
   * 检查用户是否拥有指定权限
   * @param code 权限代码，格式为 "resource:action"，如 "task:read"
   * @returns 是否拥有该权限
   */
  const hasPermission = (code: string): boolean => {
    // 超级管理员拥有所有权限
    if (isSuperAdmin) return true;
    // 通配符 '*' 表示拥有所有权限
    if (permissions.includes('*')) return true;
    return permissions.includes(code);
  };

  /**
   * 检查用户是否拥有任一指定权限
   * @param codes 权限代码数组
   * @returns 是否拥有其中任一权限
   */
  const hasAnyPermission = (codes: string[]): boolean => {
    // 超级管理员拥有所有权限
    if (isSuperAdmin) return true;
    // 通配符 '*' 表示拥有所有权限
    if (permissions.includes('*')) return true;
    return codes.some((code) => permissions.includes(code));
  };

  return { hasPermission, hasAnyPermission, permissions };
}
