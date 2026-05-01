import { Module } from '@nestjs/common';
import { ApiClientModule } from '../api-client/api-client.module';
import { DatabaseModule } from '../database/database.module';
import { ApiKeyGuard } from './guards/api-key.guard';
import { ClientRateLimitGuard } from './guards/client-rate-limit.guard';
import { ModelAllowlistGuard } from './guards/model-allowlist.guard';

@Module({
  imports: [ApiClientModule, DatabaseModule],
  providers: [ApiKeyGuard, ClientRateLimitGuard, ModelAllowlistGuard],
  /** 导出 ApiClientModule，便于 TaskModule 等在使用 ApiKeyGuard 时解析 ApiClientService */
  exports: [ApiKeyGuard, ClientRateLimitGuard, ModelAllowlistGuard, ApiClientModule],
})
export class AuthModule {}
