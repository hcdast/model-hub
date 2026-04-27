import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { QueueModule } from './queue/queue.module';
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

const processType = process.env.PROCESS_TYPE || 'api';

function getProcessModules() {
  const shared = [
    AppConfigModule,
    DatabaseModule,
    RedisModule,
    QueueModule,
    ProviderModule,
    ObservabilityModule,
    FeatureRegistryModule,
  ];

  switch (processType) {
    case 'api':
      return [...shared, AuthModule, TaskModule, HealthModule, NotificationModule];

    case 'worker':
      return [...shared, CallbackModule, NotificationModule];

    case 'scheduler':
      return [...shared, PollingModule, StatsModule, NotificationModule];

    case 'admin-server':
      return [...shared, AdminModule, StatsModule, DashboardModule, HealthModule, NotificationModule];

    default:
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
      ];
  }
}

@Module({
  imports: getProcessModules(),
})
export class AppModule {}
