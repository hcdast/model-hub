import { Module } from '@nestjs/common';
import { TaskController } from './task.controller';
import { ModelConfigController } from './model-config.controller';
import { TaskService } from './task.service';
import { TaskRepository } from './task.repository';
import { IdempotencyService } from './idempotency.service';
import { TaskTimelineService } from './task-timeline.service';
import { TaskTimingService } from './task-timing.service';
import { ProviderModule } from '../provider/provider.module';
import { DatabaseModule } from '../database/database.module';
import { QueueModule } from '../queue/queue.module';
import { AuthModule } from '../auth/auth.module';
import { ApiClientModule } from '../api-client/api-client.module';
import { ProviderHealthModule } from '../provider-health/provider-health.module';
import { ProviderRoutingService } from './provider-routing.service';
import { RoutingPreviewService } from './routing-preview.service';
@Module({
  imports: [
    DatabaseModule,
    ApiClientModule,
    AuthModule,
    ProviderModule,
    ProviderHealthModule,
    QueueModule,
  ],
  controllers: [TaskController, ModelConfigController],
  providers: [
    ProviderRoutingService,
    RoutingPreviewService,
    TaskService,
    TaskRepository,
    IdempotencyService,
    TaskTimelineService,
    TaskTimingService,
  ],
  exports: [
    TaskService,
    TaskRepository,
    TaskTimelineService,
    TaskTimingService,
    ProviderRoutingService,
    RoutingPreviewService,
  ],
})
export class TaskModule {}
