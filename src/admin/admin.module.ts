import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { DatabaseModule } from '../database/database.module';
import { ProviderModule } from '../provider/provider.module';
import { StatsModule } from '../stats/stats.module';
import { AdminAuthService } from './admin-auth.service';
import { AdminAuthController } from './admin-auth.controller';
import { AdminTaskController } from './admin-task.controller';
import { AdminStatsController } from './admin-stats.controller';
import { AdminAuditController } from './admin-audit.controller';
import { AdminModelConfigController } from './admin-model-config.controller';
import { AdminApiClientController } from './admin-api-client.controller';
import { AdminModelRoutingController } from './admin-model-routing.controller';
import { AdminProviderConfigController } from './admin-provider-config.controller';
import { AdminAccountPoolController } from './admin-account-pool.controller';
import { AdminAccountCostController } from './admin-account-cost.controller';
import { AdminBillingController } from './admin-billing.controller';
import { AdminMenuController } from './admin-menu.controller';
import { ProviderHealthController } from './provider-health.controller';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { ModelConfigService } from './model-config.service';
import { TaskTimelineService } from '../task/task-timeline.service';
import { TaskTimingService } from '../task/task-timing.service';
import { ApiClientModule } from '../api-client/api-client.module';
import { RbacModule } from './rbac.module';
import { TaskModule } from '../task/task.module';
import { QueueModule } from '../queue/queue.module';
import { ProviderHealthModule } from '../provider-health/provider-health.module';
import { AdminLinkConversionConfigController } from './admin-link-conversion-config.controller';
import { LinkConversionConfigModule } from './link-conversion-config.module';
import { AdminCallbackLogsController } from './admin-callback-logs.controller';
import { AdminSystemInfoController } from './admin-system-info.controller';

@Module({
  imports: [
    DatabaseModule,
    ApiClientModule,
    ProviderModule,
    StatsModule,
    RbacModule,
    LinkConversionConfigModule,
    TaskModule,
    QueueModule,
    ProviderHealthModule,
    BullModule.registerQueue({ name: 'callback' }),
  ],
  controllers: [
    AdminAuthController,
    AdminTaskController,
    AdminStatsController,
    AdminAuditController,
    AdminModelConfigController,
    AdminApiClientController,
    AdminModelRoutingController,
    AdminProviderConfigController,
    AdminAccountPoolController,
    AdminAccountCostController,
    AdminBillingController,
    AdminMenuController,
    ProviderHealthController,
    AdminLinkConversionConfigController,
    AdminCallbackLogsController,
    AdminSystemInfoController,
  ],
  providers: [
    AdminAuthService,
    AdminJwtGuard,
    ModelConfigService,
    TaskTimelineService,
    TaskTimingService,
  ],
  exports: [LinkConversionConfigModule],
})
export class AdminModule {}
