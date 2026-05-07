import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { DatabaseModule } from '../database/database.module';
import { TaskResourceMetadataEnqueueService } from './task-resource-metadata-enqueue.service';
import { TaskCallbackEnqueueService } from '../callback/task-callback-enqueue.service';

/**
 * 资源元数据异步队列（与 task-submit 等解耦，供 scheduler / admin / worker 共用入队能力）。
 * Global：避免 PollingModule 依赖完整 QueueModule（重复注册大量 Processor）。
 */
@Global()
@Module({
  imports: [
    DatabaseModule,
    BullModule.registerQueue({
      name: 'resource-metadata',
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 8000 },
        timeout: 120_000,
        removeOnComplete: true,
        removeOnFail: false,
      },
    }),
    BullModule.registerQueue({
      name: 'callback',
      defaultJobOptions: {
        attempts: 6,
        backoff: { type: 'exponential', delay: 60000 },
        timeout: 30000,
        removeOnComplete: true,
        removeOnFail: false,
      },
    }),
  ],
  providers: [TaskResourceMetadataEnqueueService, TaskCallbackEnqueueService],
  exports: [BullModule, TaskResourceMetadataEnqueueService, TaskCallbackEnqueueService],
})
export class ResourceMetadataQueueModule {}
