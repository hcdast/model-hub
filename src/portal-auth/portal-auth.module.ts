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
import { PortalAuthFlowService } from './portal-auth-flow.service';
import { PortalNotificationController } from './portal-notification.controller';
import { PortalNotificationService } from './portal-notification.service';
import { MongooseModule } from '@nestjs/mongoose';
import { ShortDramaCandidate, ShortDramaCandidateSchema, ShortDramaProject, ShortDramaProjectSchema } from '../short-drama/drama.schema';

@Module({
  imports: [DatabaseModule, RedisModule, MongooseModule.forFeature([{ name: ShortDramaCandidate.name, schema: ShortDramaCandidateSchema }, { name: ShortDramaProject.name, schema: ShortDramaProjectSchema }])],
  controllers: [PortalAuthController, PortalApiKeyController, PortalNotificationController],
  providers: [
    PortalAuthService,
    PortalApiKeyService,
    PortalJwtGuard,
    PortalLoginThrottleService,
    PortalAuthFlowService,
    PortalNotificationService,
  ],
  exports: [PortalAuthService, PortalApiKeyService, PortalJwtGuard],
})
export class PortalAuthModule {}
