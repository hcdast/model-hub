import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { FeatureQueueProcessor } from '../feature-queue.processor';
import { TaskSubmitJobData } from '../task-submit.processor';

@Processor('image-generate')
export class ImageGenerateProcessor {
  constructor(private readonly handler: FeatureQueueProcessor) {}

  @Process('submit')
  async handle(job: Job<TaskSubmitJobData>) {
    return this.handler.processJob(job);
  }
}
