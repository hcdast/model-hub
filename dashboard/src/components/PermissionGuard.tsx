import { type ReactNode } from 'react';
import { usePermission } from '../hooks/usePermission';

/**
 * 权限守卫组件属性
 */
interface PermissionGuardProps {
  /** 所需权限代码，格式为 "resource:action"，如 "task:read" */
  permission: string;
  /** 有权限时渲染的子组件 */
  children: ReactNode;
  /** 无权限时渲染的降级内容，默认为 null（不渲染） */
  fallback?: ReactNode;
}

/**
 * 权限守卫组件
 * 根据用户权限条件渲染子组件，无权限时渲染 fallback 内容
 *
 * @example
 * <PermissionGuard permission="task:create">
 *   <Button>新建任务</Button>
 * </PermissionGuard>
 */
export function PermissionGuard({ permission, children, fallback = null }: PermissionGuardProps) {
  const { hasPermission } = usePermission();

  // 无权限时渲染降级内容
  if (!hasPermission(permission)) {
    return <>{fallback}</>;
  }

  // 有权限时渲染子组件
  return <>{children}</>;
}
