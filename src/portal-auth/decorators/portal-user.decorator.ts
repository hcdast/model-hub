/*
 * Portal User Decorator
 * 从请求中提取当前登录用户信息
 */
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface PortalUserPayload {
  sub: string;      // 用户 ID
  email: string;
  username: string;
  role: string;
}

/**
 * 获取当前登录的 Portal 用户
 * 使用方式: @PortalUser() user: PortalUserPayload
 */
export const PortalUser = createParamDecorator(
  (data: keyof PortalUserPayload | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.portalUser as PortalUserPayload;

    if (!user) {
      return null;
    }

    return data ? user[data] : user;
  },
);

/**
 * 获取当前登录用户的 ID
 * 使用方式: @PortalUserId() userId: string
 */
export const PortalUserId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string | null => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.portalUser as PortalUserPayload;
    return user?.sub || null;
  },
);
