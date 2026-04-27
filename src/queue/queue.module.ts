import { Module, OnModuleInit } from '@nestjs/common';
import { BullModule, getQueueToken } from '@nestjs/bull';
import { ModuleRef } from '@nestjs/core';
import { Queue } from 'bull';
import { APP_CONFIG } from '../config/config.module';
import { AppConfig } from '../config/interfaces/config.interface';
import { TaskSubmitProcessor } from './task-submit.processor';
import { FeatureQueueProcessor } from './feature-queue.processor';
import { ImageGenerateProcessor } from './processors/image-generate.processor';
import { ImageToVideoProcessor } from './processors/image-to-video.processor';
import { CharacterSwapProcessor, VideoUpscaleProcessor } from './processors/other-queues.processor';
import { PROVIDER_SUB_QUEUE_PROCESSORS } from './processors/provider-sub-queue.processor';
import { QueueRegistryService } from './queue-registry.service';
import { QueueRouterService } from './queue-router.service';
import { DatabaseModule } from '../database/database.module';
import { ProviderModule } from '../provider/provider.module';
import { TaskRepository } from '../task/task.repository';
import { TaskTimelineService } from '../task/task-timeline.service';
import { TaskTimingService } from '../task/task-timing.service';
import {
  ALL_PROVIDER_SUB_QUEUE_NAMES,
  BASE_QUEUE_TO_FEATURE_TYPE,
  DEFAULT_QUEUE_OPTIONS,
  FEATURE_QUEUES,
} from './queue.constants';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        redis: {
          host: config.redis.host,
          port: config.redis.port,
          password: config.redis.password || undefined,
          db: config.redis.db || 0,
          maxRetriesPerRequest: null,
        },
        prefix: 'model-hub',
      }),
    }),
    BullModule.registerQueue(
      { name: 'task-submit', defaultJobOptions: DEFAULT_QUEUE_OPTIONS },
      ...FEATURE_QUEUES.map((name) => ({ name, defaultJobOptions: DEFAULT_QUEUE_OPTIONS })),
      ...ALL_PROVIDER_SUB_QUEUE_NAMES.map((name) => ({ name, defaultJobOptions: DEFAULT_QUEUE_OPTIONS })),
      {
        name: 'callback',
        defaultJobOptions: {
          attempts: 6,
          backoff: { type: 'exponential', delay: 60000 },
          timeout: 30000,
          removeOnComplete: true,
          removeOnFail: false,
        },
      },
    ),
    DatabaseModule,
    ProviderModule,
  ],
  providers: [
    FeatureQueueProcessor,
    TaskSubmitProcessor,
    ImageGenerateProcessor,
    ImageToVideoProcessor,
    CharacterSwapProcessor,
    VideoUpscaleProcessor,
    ...PROVIDER_SUB_QUEUE_PROCESSORS,
    TaskRepository,
    TaskTimelineService,
    TaskTimingService,
    QueueRegistryService,
    QueueRouterService,
  ],
  exports: [BullModule, QueueRegistryService, QueueRouterService],
})
export class QueueModule implements OnModuleInit {
  constructor(
    private readonly registry: QueueRegistryService,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit() {
    const register = (name: string, featureType: string, provider?: string) => {
      const queue = this.moduleRef.get<Queue>(getQueueToken(name), { strict: false });
      this.registry.register({ name, queue, featureType, provider });
    };

    register('task-submit', 'all');

    for (const base of FEATURE_QUEUES) {
      register(base, BASE_QUEUE_TO_FEATURE_TYPE[base]);
    }

    for (const fullName of ALL_PROVIDER_SUB_QUEUE_NAMES) {
      const sep = fullName.indexOf(':');
      const base = fullName.slice(0, sep) as keyof typeof BASE_QUEUE_TO_FEATURE_TYPE;
      const provider = fullName.slice(sep + 1);
      register(fullName, BASE_QUEUE_TO_FEATURE_TYPE[base], provider);
    }

    register('callback', 'callback');
  }
}
