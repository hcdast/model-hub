import {
  Injectable, CanActivate, ExecutionContext, UnauthorizedException, Inject,
} from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module';
import { AppConfig } from '../../config/interfaces/config.interface';
import { Request } from 'express';
import { ApiClientService } from '../../api-client/api-client.service';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly headerName: string;

  constructor(
    @Inject(APP_CONFIG) private readonly appConfig: AppConfig,
    private readonly apiClients: ApiClientService,
  ) {
    this.headerName = (appConfig.auth?.apiKeyHeader || 'X-API-Key').toLowerCase();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const rawHeader = request.headers[this.headerName];
    const apiKey = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    if (!apiKey || !String(apiKey).trim()) {
      throw new UnauthorizedException('Missing API Key');
    }
    const trimmed = String(apiKey).trim();
    const strict = this.appConfig.auth?.requireRegisteredApiKey === true;

    if (!strict) {
      (request as any).clientId = trimmed;
      return true;
    }

    const client = await this.apiClients.validatePresentedKey(trimmed);
    if (!client) {
      throw new UnauthorizedException('Invalid API Key');
    }
    (request as any).clientId = client.clientId;
    (request as any).apiClient = { clientId: client.clientId, name: client.name };
    return true;
  }
}
