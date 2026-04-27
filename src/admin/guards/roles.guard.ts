import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // 如果没有指定角色要求，允许访问
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.adminUser;

    // 检查用户是否存在
    if (!user) {
      throw new ForbiddenException('用户未认证');
    }

    // 检查用户角色是否满足要求
    // 用户可能有多个角色，只要有一个角色满足要求即可
    const hasRequiredRole = user.roles && user.roles.some((role: string) => requiredRoles.includes(role));
    if (!hasRequiredRole) {
      throw new ForbiddenException('权限不足，需要以下角色之一: ' + requiredRoles.join(', '));
    }

    return true;
  }
}
