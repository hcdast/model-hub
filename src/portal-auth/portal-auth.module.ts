/*
 * Portal Auth Module
 * 开发者门户认证模块
 */
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { RedisModule } from '../redis/redis.module';
import { PortalAuthService } from './portal-auth.service';
import { PortalApiKeyService } from './portal-api-key.service';
import { PortalAuthController } from './portal-auth.controller';
import { PortalApiKeyController } from './portal-api-key.controller';
import { PortalJwtGuard } from './guards/portal-jwt.guard';
import { PortalLoginThrottleService } from './portal-login-throttle.service';

@Module({
  imports: [DatabaseModule, RedisModule],
  controllers: [PortalAuthController, PortalApiKeyController],
  providers: [
    PortalAuthService,
    PortalApiKeyService,
    PortalJwtGuard,
    PortalLoginThrottleService,
  ],
  exports: [PortalAuthService, PortalApiKeyService, PortalJwtGuard],
})
export class PortalAuthModule {}
