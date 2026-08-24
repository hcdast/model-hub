import {
  Injectable, CanActivate, ExecutionContext, UnauthorizedException, Inject,
} from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module';
import { AppConfig } from '../../config/interfaces/config.interface';
import { Request } from 'express';
import { ApiClientService } from '../../api-client/api-client.service';
import { PortalApiKeyService } from '../../portal-auth/portal-api-key.service';

interface ApiKeyRequest extends Request {
  apiKey?: string;
  apiClient?: {
    apiKey: string;
    name: string;
    isPortalKey?: boolean;
    userId?: string;
    subjectId?: string;
  };
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly headerName: string;

  constructor(
    @Inject(APP_CONFIG) private readonly appConfig: AppConfig,
    private readonly apiClients: ApiClientService,
    private readonly portalApiKeyService: PortalApiKeyService,
  ) {
    this.headerName = (appConfig.auth?.apiKeyHeader || 'X-API-Key').toLowerCase();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ApiKeyRequest>();
    const rawHeader = request.headers[this.headerName];
    const apiKey = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    if (!apiKey || !String(apiKey).trim()) {
      throw new UnauthorizedException('Missing API Key');
    }
    const trimmed = String(apiKey).trim();

    // 统一使用 mh_ 前缀
    if (!trimmed.startsWith('mh_')) {
      throw new UnauthorizedException('Invalid API Key format');
    }

    // 已注册 Key 始终优先解析，确保 Portal Key 使用非敏感 billingKey 进入任务链路。
    const client = await this.apiClients.validatePresentedKey(trimmed);
    if (client) {
      request.apiKey = client.apiKey;
      request.apiClient = { apiKey: client.apiKey, name: client.name ?? 'API Client' };
      return true;
    }

    const portalKey = await this.portalApiKeyService.validate(trimmed);
    if (portalKey) {
      request.apiKey = portalKey.billingKey;
      request.apiClient = {
        apiKey: portalKey.billingKey,
        name: portalKey.name,
        isPortalKey: true,
        userId: portalKey.userId,
        subjectId: portalKey._id.toString(),
      };
      return true;
    }

    const strict = this.appConfig.auth?.requireRegisteredApiKey === true;
    if (!strict) {
      request.apiKey = trimmed;
      return true;
    }

    throw new UnauthorizedException('Invalid API Key');
  }
}
