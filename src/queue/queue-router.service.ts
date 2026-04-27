import { Injectable, Logger } from '@nestjs/common';
import { QueueRegistryService } from './queue-registry.service';
import { FEATURE_TYPE_TO_QUEUE } from './queue.constants';

@Injectable()
export class QueueRouterService {
  private readonly logger = new Logger(QueueRouterService.name);

  constructor(private readonly queueRegistry: QueueRegistryService) {}

  resolveQueueName(featureType: string, provider: string): string {
    const baseQueue =
      FEATURE_TYPE_TO_QUEUE[featureType] ??
      (featureType.includes('_') ? featureType.replace(/_/g, '-') : featureType);
    const providerQueue = `${baseQueue}:${provider}`;
    if (this.queueRegistry.has(providerQueue)) {
      return providerQueue;
    }
    if (this.queueRegistry.has(baseQueue)) {
      return baseQueue;
    }
    return 'task-submit';
  }

  async enqueue(
    featureType: string,
    provider: string,
    jobName: string,
    data: any,
    options?: { priority?: number },
  ): Promise<string> {
    const queueName = this.resolveQueueName(featureType, provider);
    const queue = this.queueRegistry.getQueue(queueName);

    if (!queue) {
      this.logger.warn(
        `Queue ${queueName} not found, falling back to task-submit`,
      );
      const fallback = this.queueRegistry.getQueue('task-submit');
      if (!fallback) throw new Error('No available queue');
      const job = await fallback.add(jobName, data, options);
      return job.id.toString();
    }

    const job = await queue.add(jobName, data, options);
    this.logger.debug(`Job enqueued: queue=${queueName}, jobId=${job.id}`);
    return job.id.toString();
  }

  /**
   * 从 Bull 队列中移除匹配 taskId 的 waiting job（尽力而为）
   */
  async removeJob(featureType: string, provider: string, taskId: string): Promise<boolean> {
    const queueName = this.resolveQueueName(featureType, provider);
    const queue = this.queueRegistry.getQueue(queueName);
    if (!queue) {
      this.logger.warn(`removeJob: queue ${queueName} not found`);
      return false;
    }

    try {
      const waitingJobs = await queue.getWaiting();
      for (const job of waitingJobs) {
        if (job.data?.taskId === taskId) {
          await job.remove();
          this.logger.debug(`Job removed: queue=${queueName}, jobId=${job.id}, taskId=${taskId}`);
          return true;
        }
      }
      this.logger.debug(`removeJob: no waiting job found for taskId=${taskId} in queue=${queueName}`);
      return false;
    } catch (err: any) {
      this.logger.warn(`removeJob failed for taskId=${taskId}: ${err.message}`);
      return false;
    }
  }

  /**
   * 获取 callback 队列实例
   */
  getCallbackQueue() {
    return this.queueRegistry.getQueue('callback') ?? null;
  }

  /**
   * 以新优先级重新入队
   */
  async reEnqueueWithPriority(
    featureType: string,
    provider: string,
    jobData: any,
    priority: number,
  ): Promise<string> {
    return this.enqueue(featureType, provider, 'submit', jobData, { priority });
  }
}
