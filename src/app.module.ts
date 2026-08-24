import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { QueueModule } from './queue/queue.module';
import { ResourceMetadataQueueModule } from './queue/resource-metadata-queue.module';
import { AuthModule } from './auth/auth.module';
import { TaskModule } from './task/task.module';
import { ProviderModule } from './provider/provider.module';
import { CallbackModule } from './callback/callback.module';
import { PollingModule } from './polling/polling.module';
import { HealthModule } from './health/health.module';
import { ObservabilityModule } from './observability/observability.module';
import { StatsModule } from './stats/stats.module';
import { AdminModule } from './admin/admin.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { NotificationModule } from './notification/notification.module';
import { FeatureRegistryModule } from './common/feature-registry.module';
import { ProviderHealthModule } from './provider-health/provider-health.module';
import { BillingModule } from './billing/billing.module';
import { WorkflowModule } from './workflow/workflow.module';
import { PortalAuthModule } from './portal-auth/portal-auth.module';
import { resolveProcessType, MONOLITH_PROCESS_TYPE } from './common/process-type.util';

const processType = resolveProcessType(process.env.PROCESS_TYPE);

function getProcessModules() {
  // 所有进程共享的模块（api, worker, scheduler, admin-server 均加载）
  const shared = [
    AppConfigModule,
    DatabaseModule,
    RedisModule,
    QueueModule,
    ResourceMetadataQueueModule,
    ProviderModule,
    ObservabilityModule,
    FeatureRegistryModule,
    BillingModule, // 计费模块（@Global），提供 BillingAdapter / PricingService / BillingService / WalletService
  ];

  switch (processType) {
    case 'api':
      return [...shared, AuthModule, TaskModule, HealthModule, NotificationModule, ProviderHealthModule, WorkflowModule, PortalAuthModule];

    case 'worker':
      return [...shared, CallbackModule, NotificationModule, ProviderHealthModule];

    case 'scheduler':
      return [...shared, PollingModule, StatsModule, NotificationModule, ProviderHealthModule];

    case 'admin-server':
      return [...shared, AdminModule, StatsModule, DashboardModule, HealthModule, NotificationModule];

    case MONOLITH_PROCESS_TYPE:
      // 仅非 production：单进程加载全模块（本地联调）；生产环境在 resolveProcessType 已拦截
      return [
        ...shared,
        AuthModule,
        TaskModule,
        CallbackModule,
        PollingModule,
        StatsModule,
        AdminModule,
        HealthModule,
        NotificationModule,
        ProviderHealthModule,
        WorkflowModule,
        PortalAuthModule,
      ];
  }
}

@Module({
  imports: getProcessModules(),
})
export class AppModule {}
