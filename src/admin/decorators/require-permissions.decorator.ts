import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

/**
 * 权限要求类型
 * - string[]: 多个权限（AND逻辑）- 用户必须拥有所有权限
 * - { any: string[] }: 可选权限（OR逻辑）- 用户只需拥有任一权限
 */
export type PermissionRequirement = string[] | { any: string[] };

/**
 * 权限装饰器
 * 
 * 用法示例：
 * 
 * 1. 单个权限：
 * @RequirePermissions('user:create')
 * 
 * 2. 多个权限（AND逻辑）：
 * @RequirePermissions('user:create', 'role:read')
 * 
 * 3. 可选权限（OR逻辑）：
 * @RequirePermissions({ any: ['user:create', 'user:update'] })
 */
export const RequirePermissions = (
  ...permissions: string[] | [{ any: string[] }]
): MethodDecorator => {
  // 检查是否为 OR 逻辑
  if (
    permissions.length === 1 &&
    typeof permissions[0] === 'object' &&
    'any' in permissions[0]
  ) {
    return SetMetadata(PERMISSIONS_KEY, permissions[0]);
  }

  // AND 逻辑（默认）
  return SetMetadata(PERMISSIONS_KEY, permissions as string[]);
};
