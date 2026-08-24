/*
 * Portal JWT Guard
 * 开发者门户 JWT 认证守卫
 */
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { PortalAuthService } from '../portal-auth.service';

@Injectable()
export class PortalJwtGuard implements CanActivate {
  constructor(private readonly portalAuthService: PortalAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('Missing access token');
    }

    try {
      const payload = this.portalAuthService.verifyAccessToken(token);
      const user = await this.portalAuthService.getUserById(payload.sub);
      if (user.status !== 'active') {
        throw new UnauthorizedException('Portal user is not active');
      }
      (request as Request & { portalUser?: Record<string, unknown> }).portalUser = {
        sub: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
      };
      return true;
    } catch (err) {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    // 优先从 Authorization header 获取
    const authHeader = request.headers.authorization;
    if (authHeader) {
      const [type, token] = authHeader.split(' ');
      if (type === 'Bearer' && token) {
        return token;
      }
    }

    // 其次从 cookie 获取
    const cookies = request.cookies as Record<string, string>;
    if (cookies?.portal_access_token) {
      return cookies.portal_access_token;
    }

    return undefined;
  }
}
