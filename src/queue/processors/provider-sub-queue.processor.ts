import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { FeatureQueueProcessor } from '../feature-queue.processor';
import { TaskSubmitJobData } from '../task-submit.processor';
import { ALL_PROVIDER_SUB_QUEUE_NAMES } from '../queue.constants';

function createProviderSubQueueProcessorClass(queueName: string) {
  @Processor(queueName)
  class ProviderSubQueueProcessor {
    constructor(public readonly handler: FeatureQueueProcessor) {}

    @Process('submit')
    async handle(job: Job<TaskSubmitJobData>) {
      return this.handler.submitToProvider(job);
    }
  }

  const safeName = queueName.replace(/[^a-zA-Z0-9]+/g, '_');
  Object.defineProperty(ProviderSubQueueProcessor, 'name', {
    value: `ProviderSubQueue_${safeName}`,
  });

  return ProviderSubQueueProcessor;
}

export const PROVIDER_SUB_QUEUE_PROCESSORS = ALL_PROVIDER_SUB_QUEUE_NAMES.map((queueName) =>
  createProviderSubQueueProcessorClass(queueName),
);
