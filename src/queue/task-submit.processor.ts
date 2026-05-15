import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { FeatureQueueProcessor } from './feature-queue.processor';
import { QueueRegistryService } from './queue-registry.service';
import { FEATURE_TYPE_TO_QUEUE } from './queue.constants';

export interface TaskSubmitJobData {
  taskId: string;
  provider: string;
  model: string;
  featureType: string;
  priority: number;
  apiKey: string;
  enqueuedAt: number;
}

/**
 * 兜底 Processor：消费 task-submit 队列。
 * 优先转发到功能级队列，无匹配时直接处理。
 */
@Processor('task-submit')
export class TaskSubmitProcessor {
  private readonly logger = new Logger(TaskSubmitProcessor.name);

  constructor(
    private readonly featureProcessor: FeatureQueueProcessor,
    private readonly queueRegistry: QueueRegistryService,
  ) {}

  @Process('submit')
  async handleSubmit(job: Job<TaskSubmitJobData>): Promise<void> {
    const { taskId, featureType, provider } = job.data;
    const featureQueueName = FEATURE_TYPE_TO_QUEUE[featureType];

    if (featureQueueName) {
      const providerQueue = `${featureQueueName}:${provider}`;
      const targetName = this.queueRegistry.has(providerQueue)
        ? providerQueue
        : featureQueueName;
      const targetQueue = this.queueRegistry.getQueue(targetName);

      if (targetQueue) {
        await targetQueue.add('submit', job.data, { priority: job.data.priority });
        this.logger.debug(`Forwarded ${taskId} → ${targetName}`);
        return;
      }
    }

    this.logger.debug(`Fallback processing: ${taskId}`);
    await this.featureProcessor.submitToProvider(job);
  }
}
