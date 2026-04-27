import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { FeatureQueueProcessor } from '../feature-queue.processor';
import { TaskSubmitJobData } from '../task-submit.processor';

@Processor('image-to-video')
export class ImageToVideoProcessor {
  constructor(private readonly handler: FeatureQueueProcessor) {}

  @Process('submit')
  async handle(job: Job<TaskSubmitJobData>) {
    return this.handler.processJob(job);
  }
}
