import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue, Job } from 'bull';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TaskRepository } from '../task/task.repository';
import { ProviderRegistry } from '../provider/provider.registry';
import { TaskTimelineService, TimelineEvent } from '../task/task-timeline.service';
import { TaskTimingService } from '../task/task-timing.service';
import { RateLimiterService } from '../redis/rate-limiter.service';
import { MetricsService } from '../observability/metrics.service';
import { TaskStatus } from '../common/constants/task-status';
import { APP_CONFIG } from '../config/config.module';
import { AppConfig } from '../config/interfaces/config.interface';
import { QueueRegistryService } from './queue-registry.service';
import { TaskSubmitJobData } from './task-submit.processor';
import { Processor, Process } from '@nestjs/bull';
import { ErrorLogger } from '../common/utils/error-logger.util';
import { buildTaskEvent, buildProviderEvent } from '../notification/events/event-emitter.helper';

@Injectable()
export class FeatureQueueProcessor {
  private readonly logger = new Logger(FeatureQueueProcessor.name);

  constructor(
    private readonly taskRepo: TaskRepository,
    private readonly providerRegistry: ProviderRegistry,
    private readonly timelineService: TaskTimelineService,
    private readonly timingService: TaskTimingService,
    private readonly rateLimiter: RateLimiterService,
    private readonly metrics: MetricsService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @InjectQueue('callback') private readonly callbackQueue: Queue,
    private readonly queueRegistry: QueueRegistryService,
  ) {}

  async processJob(job: Job<TaskSubmitJobData>): Promise<void> {
    const { taskId, provider: providerName, featureType } = job.data;

    const providerQueueName = `${this.featureToQueue(featureType)}:${providerName}`;
    if (
      !job.queue.name.includes(':') &&
      this.queueRegistry.has(providerQueueName)
    ) {
      const providerQueue = this.queueRegistry.getQueue(providerQueueName);
      if (providerQueue) {
        await providerQueue.add('submit', job.data, { priority: job.data.priority });
        this.logger.debug(`Forwarded ${taskId} → ${providerQueueName}`);
        return;
      }
    }

    await this.submitToProvider(job);
  }

  async submitToProvider(job: Job<TaskSubmitJobData>): Promise<void> {
    const { taskId, provider: providerName, featureType } = job.data;
    this.logger.log(`Submit: ${taskId} → ${providerName}`);

    const context = {
      taskId,
      provider: providerName,
      featureType,
      queueName: job.queue.name,
      jobId: String(job.id),
    };

    const dequeuedAt = new Date();
    await this.timingService.recordTiming(taskId, 'dequeuedAt', dequeuedAt);
    await this.timelineService.addEvent(taskId, TimelineEvent.TASK_DEQUEUED, {
      workerId: process.pid, attempt: job.attemptsMade, queue: job.queue.name,
    });

    const task = await this.taskRepo.findByTaskId(taskId);
    if (!task) return;
    if (task.status !== TaskStatus.PENDING) return;

    const adapter = this.providerRegistry.getAdapter(providerName);
    if (!adapter) {
      const errorMsg = `Adapter not found: ${providerName}`;
      ErrorLogger.logError(
        this.logger,
        new Error(errorMsg),
        context,
        'Provider adapter not found',
      );
      
      await this.taskRepo.updateStatus(taskId, TaskStatus.PENDING, TaskStatus.FAILED, {
        error: { code: 'PROVIDER_NOT_FOUND', message: errorMsg, retryable: false },
      });
      this.metrics.taskFailedTotal.inc({ feature_type: featureType, provider: providerName, error_code: 'PROVIDER_NOT_FOUND' });
      this.eventEmitter.emit('system.provider_error', buildProviderEvent(providerName, 'PROVIDER_NOT_FOUND', errorMsg));
      return;
    }

    const rlConfig = adapter.getRateLimitConfig();
    const allowed = await this.rateLimiter.acquire(
      `provider:${providerName}:qps`, rlConfig.maxPerSecond, 1000,
    );
    if (!allowed) {
      ErrorLogger.logWarning(
        this.logger,
        `Rate limited, requeuing task`,
        context,
      );
      throw new Error(`Rate limited by ${providerName}`);
    }

    const concToken = await this.rateLimiter.acquireConcurrent(
      `provider:${providerName}:concurrent`, rlConfig.maxConcurrent, 120000,
    );
    if (!concToken) {
      ErrorLogger.logWarning(
        this.logger,
        `Concurrent limit reached, requeuing task`,
        context,
      );
      throw new Error(`Concurrent limit for ${providerName}`);
    }

    await this.timelineService.addEvent(taskId, TimelineEvent.PROVIDER_SUBMIT_START, { provider: providerName });
    const submittedAt = new Date();
    await this.timingService.recordTiming(taskId, 'submittedAt', submittedAt);

    const providerStart = Date.now();
    try {
      const result = await adapter.submitTask({
        taskId, 
        model: task.providerModel || task.model, // 优先使用 providerModel
        input: task.requestPayload?.input || {},
        options: task.requestPayload?.options,
      });

      this.metrics.providerRequestDuration.observe(
        { provider: providerName, operation: 'submit' },
        Date.now() - providerStart,
      );

      await this.timelineService.addEvent(taskId, TimelineEvent.PROVIDER_SUBMIT_OK, {
        providerTaskId: result.providerTaskId, isSync: result.isSync,
      });

      if (result.isSync && result.result) {
        const completedAt = new Date();
        await this.timingService.recordTiming(taskId, 'completedAt', completedAt);
        await this.timingService.calculateAndSave(taskId);

        await this.taskRepo.updateStatus(taskId, TaskStatus.PENDING, TaskStatus.SUCCESS, {
          providerTask: { providerTaskId: result.providerTaskId, rawMeta: result.rawResponse },
          resultPayload: result.result,
        });

        const e2eMs = completedAt.getTime() - (task as any).createdAt.getTime();
        this.metrics.taskCompletedTotal.inc({ feature_type: featureType, provider: providerName, status: 'SUCCESS' });
        this.metrics.taskDuration.observe({ feature_type: featureType, provider: providerName }, e2eMs);
        await this.timelineService.addEvent(taskId, TimelineEvent.TASK_SUCCESS, { totalE2eMs: e2eMs });
        this.eventEmitter.emit('system.task_success', buildTaskEvent(taskId, task.model, providerName, 'success', e2eMs));

        if (task.callback?.url) {
          await this.callbackQueue.add('deliver', { taskId, callbackUrl: task.callback.url, callbackSecret: task.callback.secret });
        }
      } else {
        await this.taskRepo.updateStatus(taskId, TaskStatus.PENDING, TaskStatus.SUBMITTED, {
          providerTask: { providerTaskId: result.providerTaskId, rawMeta: result.rawResponse },
          'polling.nextPollAt': new Date(Date.now() + this.config.polling.defaultIntervalMs),
        } as any);
      }
    } catch (err: any) {
      this.metrics.providerRequestDuration.observe(
        { provider: providerName, operation: 'submit' },
        Date.now() - providerStart,
      );

      const mapped = adapter.mapError(err);
      
      // 使用统一的错误日志工具
      ErrorLogger.logError(
        this.logger,
        err,
        { ...context, model: task.model },
        `Provider submit failed`,
      );

      await this.timelineService.addEvent(taskId, TimelineEvent.PROVIDER_SUBMIT_FAIL, {
        errorCode: mapped.code, errorMsg: mapped.message, retryable: mapped.retryable,
      });

      if (!mapped.retryable) {
        await this.taskRepo.updateStatus(taskId, TaskStatus.PENDING, TaskStatus.FAILED, {
          error: { code: mapped.code, message: mapped.message, retryable: false },
        });
        this.metrics.taskFailedTotal.inc({ feature_type: featureType, provider: providerName, error_code: mapped.code });
        this.eventEmitter.emit('system.task_failed', buildTaskEvent(taskId, task.model, providerName, 'failed', Date.now() - (task as any).createdAt.getTime()));
        this.eventEmitter.emit('system.provider_error', buildProviderEvent(providerName, mapped.code, mapped.message));
        return;
      }
      throw err;
    } finally {
      if (concToken) {
        await this.rateLimiter.releaseConcurrent(`provider:${providerName}:concurrent`, concToken);
      }
    }
  }

  private featureToQueue(featureType: string): string {
    const map: Record<string, string> = {
      image_generate: 'image-generate',
      image_to_video: 'image-to-video',
      text_to_video: 'image-to-video',
      character_swap: 'character-swap',
      video_upscale: 'video-upscale',
    };
    return map[featureType] || 'task-submit';
  }
}
