import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module';
import { AppConfig } from '../../config/interfaces/config.interface';
import { Request } from 'express';
import { ApiClientService } from '../../api-client/api-client.service';
import { PortalApiKeyService } from '../../portal-auth/portal-api-key.service';
import { PortalAuthService } from '../../portal-auth/portal-auth.service';

interface AuthenticatedRequest extends Request {
  apiKey?: string;
  apiClient?: {
    apiKey?: string;
    name?: string;
    isPortalKey?: boolean;
    isPortalUser?: boolean;
    userId?: string;
    email?: string;
    username?: string;
    role?: string;
    subjectType: 'admin-client' | 'portal-api-key' | 'portal-user';
    subjectId: string;
  };
  portalUser?: {
    sub: string;
    email?: string;
    username?: string;
    role?: string;
  };
}

/**
 * 支持 API Key 或 JWT Token 认证的 Guard
 * - 如果请求头包含 X-API-Key，使用 API Key 认证
 * - 如果请求头包含 Authorization: Bearer，使用 JWT Token 认证
 */
@Injectable()
export class ApiKeyOrJwtGuard implements CanActivate {
  private readonly headerName: string;

  constructor(
    @Inject(APP_CONFIG) private readonly appConfig: AppConfig,
    private readonly apiClients: ApiClientService,
    private readonly portalApiKeyService: PortalApiKeyService,
    private readonly portalAuthService: PortalAuthService,
  ) {
    this.headerName = (appConfig.auth?.apiKeyHeader || 'X-API-Key').toLowerCase();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    // 检查是否有 API Key
    const rawHeader = request.headers[this.headerName];
    const apiKey = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

    // 检查是否有 JWT Token
    const authHeader = request.headers.authorization;
    const jwtToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    // 优先使用 API Key
    if (apiKey && String(apiKey).trim()) {
      return this.validateApiKey(request, String(apiKey).trim());
    }

    // 其次使用 JWT Token
    if (jwtToken) {
      return this.validateJwtToken(request, jwtToken);
    }

    throw new UnauthorizedException('Missing API Key or access token');
  }

  private async validateApiKey(request: AuthenticatedRequest, apiKey: string): Promise<boolean> {
    if (!apiKey.startsWith('mh_')) {
      throw new UnauthorizedException('Invalid API Key format');
    }

    // 工作流资源必须绑定到已注册主体，不允许开发模式下的匿名兼容 Key。

    // 优先尝试作为 API Client 验证
    const client = await this.apiClients.validatePresentedKey(apiKey);
    if (client) {
      request.apiKey = client.apiKey;
      request.apiClient = {
        apiKey: client.apiKey,
        name: client.name,
        subjectType: 'admin-client',
        subjectId: client.apiKey,
      };
      return true;
    }

    // 如果不是 API Client，尝试作为 Portal API Key 验证
    const portalKey = await this.portalApiKeyService.validate(apiKey);
    if (portalKey) {
      request.apiKey = portalKey.billingKey;
      request.apiClient = {
        apiKey: portalKey.billingKey,
        name: portalKey.name,
        isPortalKey: true,
        userId: portalKey.userId,
        subjectType: 'portal-api-key',
        subjectId: portalKey._id.toString(),
      };
      return true;
    }

    throw new UnauthorizedException('Invalid API Key');
  }

  private async validateJwtToken(request: AuthenticatedRequest, token: string): Promise<boolean> {
    try {
      const payload = this.portalAuthService.verifyAccessToken(token);
      const user = await this.portalAuthService.getUserById(payload.sub);
      if (user.status !== 'active') {
        throw new UnauthorizedException('Portal user is not active');
      }
      request.portalUser = {
        ...payload,
        email: user.email,
        username: user.username,
        role: user.role,
      };
      request.apiClient = {
        isPortalUser: true,
        userId: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        subjectType: 'portal-user',
        subjectId: user.id,
      };
      return true;
    } catch (err) {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }
}
