import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AdminAuthService } from '../admin-auth.service';
import { Request } from 'express';

@Injectable()
export class AdminJwtGuard implements CanActivate {
  constructor(private readonly authService: AdminAuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('未提供授权令牌');
    }

    const token = authHeader.slice(7);
    const payload = this.authService.verifyToken(token);
    
    // 将用户信息同时设置到 adminUser 和 user 属性
    // adminUser 用于向后兼容，user 用于控制器和 PermissionGuard 中获取用户信息
    (request as any).adminUser = payload;
    (request as any).user = {
      id: payload.sub,
      userId: payload.sub,
      username: payload.username,
      roles: payload.roles,
    };
    
    return true;
  }
}
