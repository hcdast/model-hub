import { Module } from '@nestjs/common';
import { ApiClientModule } from '../api-client/api-client.module';
import { DatabaseModule } from '../database/database.module';
import { PortalAuthModule } from '../portal-auth/portal-auth.module';
import { ApiKeyGuard } from './guards/api-key.guard';
import { ApiKeyOrJwtGuard } from './guards/api-key-or-jwt.guard';
import { ClientRateLimitGuard } from './guards/client-rate-limit.guard';
import { ModelAllowlistGuard } from './guards/model-allowlist.guard';

@Module({
  imports: [ApiClientModule, DatabaseModule, PortalAuthModule],
  providers: [ApiKeyGuard, ApiKeyOrJwtGuard, ClientRateLimitGuard, ModelAllowlistGuard],
  /** 导出 ApiClientModule，便于 TaskModule 等在使用 ApiKeyGuard 时解析 ApiClientService */
  exports: [ApiKeyGuard, ApiKeyOrJwtGuard, ClientRateLimitGuard, ModelAllowlistGuard, ApiClientModule, PortalAuthModule],
})
export class AuthModule {}
