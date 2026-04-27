import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { FeatureQueueProcessor } from '../feature-queue.processor';
import { TaskSubmitJobData } from '../task-submit.processor';

@Processor('character-swap')
export class CharacterSwapProcessor {
  constructor(private readonly handler: FeatureQueueProcessor) {}

  @Process('submit')
  async handle(job: Job<TaskSubmitJobData>) {
    return this.handler.processJob(job);
  }
}

@Processor('video-upscale')
export class VideoUpscaleProcessor {
  constructor(private readonly handler: FeatureQueueProcessor) {}

  @Process('submit')
  async handle(job: Job<TaskSubmitJobData>) {
    return this.handler.processJob(job);
  }
}
