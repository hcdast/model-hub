import {
  Injectable,
  CanActivate,
  ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  PERMISSIONS_KEY,
  PermissionRequirement,
} from '../decorators/require-permissions.decorator';
import { PermissionCheckService } from '../permission-check.service';
import { PermissionDeniedException } from '../../common/exceptions/rbac.exceptions';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionCheckService: PermissionCheckService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 1. 获取装饰器中声明的权限要求
    const requiredPermissions = this.reflector.getAllAndOverride<PermissionRequirement>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // 2. 如果没有权限要求，允许访问
    if (!requiredPermissions) {
      return true;
    }

    // 3. 获取当前用户
    const request = context.switchToHttp().getRequest();
    const user = request.user || request.adminUser;

    // 4. 检查用户是否存在
    if (!user) {
      throw new PermissionDeniedException('用户未认证');
    }

    // 5. 检查用户是否被禁用
    // 注意：getUserPermissions 会检查用户状态，如果被禁用会返回空权限列表
    const userId = user.id || user.userId || user.sub;
    if (!userId) {
      throw new PermissionDeniedException('无效的用户信息');
    }

    // 6. 检查权限
    const hasPermission = await this.checkPermissions(
      userId,
      requiredPermissions,
    );

    if (!hasPermission) {
      throw new PermissionDeniedException('权限不足');
    }

    return true;
  }

  /**
   * 检查用户权限
   * @param userId 用户ID
   * @param requirement 权限要求
   */
  private async checkPermissions(
    userId: string,
    requirement: PermissionRequirement,
  ): Promise<boolean> {
    // OR 逻辑：用户只需拥有任一权限
    if (typeof requirement === 'object' && 'any' in requirement) {
      return this.permissionCheckService.checkAnyPermission(
        userId,
        requirement.any,
      );
    }

    // AND 逻辑：用户必须拥有所有权限
    if (Array.isArray(requirement)) {
      return this.permissionCheckService.checkAllPermissions(
        userId,
        requirement,
      );
    }

    return false;
  }
}
