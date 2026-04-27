import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TaskRepository } from '../task/task.repository';
import { ProviderRegistry } from '../provider/provider.registry';
import { ProviderConfigService } from '../provider/provider-config.service';
import { TaskTimelineService, TimelineEvent } from '../task/task-timeline.service';
import { TaskTimingService } from '../task/task-timing.service';
import { TaskStatus } from '../common/constants/task-status';
import { APP_CONFIG } from '../config/config.module';
import { AppConfig } from '../config/interfaces/config.interface';
import { MetricsService } from '../observability/metrics.service';
import { TaskDocument } from '../database/schemas/task.schema';
import { RateLimiterService } from '../redis/rate-limiter.service';
import { ErrorLogger } from '../common/utils/error-logger.util';
import { buildTaskEvent, buildProviderEvent } from '../notification/events/event-emitter.helper';

@Injectable()
export class PollingService {
  private readonly logger = new Logger(PollingService.name);

  constructor(
    private readonly taskRepo: TaskRepository,
    private readonly providerRegistry: ProviderRegistry,
    private readonly providerConfig: ProviderConfigService,
    private readonly timelineService: TaskTimelineService,
    private readonly timingService: TaskTimingService,
    private readonly metrics: MetricsService,
    private readonly rateLimiter: RateLimiterService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @InjectQueue('callback') private readonly callbackQueue: Queue,
  ) {}

  async pollPendingTasks(): Promise<number> {
    const batchSize = this.config.polling.batchSize;
    const tasks = await this.taskRepo.findPollableTasks(batchSize, new Date());
    if (tasks.length === 0) return 0;

    let processed = 0;
    for (const task of tasks) {
      try { 
        await this.pollSingleTask(task); 
        processed++; 
      } catch (err: any) { 
        ErrorLogger.logError(
          this.logger,
          err,
          { taskId: task.taskId, provider: task.provider },
          'Poll task failed',
        );
      }
    }
    return processed;
  }

  private async pollSingleTask(task: TaskDocument): Promise<void> {
    const adapter = this.providerRegistry.getAdapter(task.provider);
    if (!adapter) {
      ErrorLogger.logWarning(
        this.logger,
        'Adapter not found for provider',
        { taskId: task.taskId, provider: task.provider },
      );
      return;
    }
    const providerName = task.provider;
    const providerTaskId = task.providerTask?.providerTaskId;
    if (!providerTaskId) {
      ErrorLogger.logWarning(
        this.logger,
        'Provider task ID not found',
        { taskId: task.taskId, provider: task.provider },
      );
      return;
    }

    const pollCount = (task.polling?.pollCount ?? 0) + 1;
    const elapsed = Date.now() - (task as any).createdAt.getTime();
    const maxPollCount = task.polling?.maxPollCount ?? this.config.polling.maxPollCount;
    const maxDuration = task.polling?.maxDuration ?? this.config.polling.maxDurationMs;

    if (pollCount > maxPollCount || elapsed > maxDuration) {
      ErrorLogger.logWarning(
        this.logger,
        `Poll timeout: count=${pollCount}/${maxPollCount}, elapsed=${elapsed}ms/${maxDuration}ms`,
        { taskId: task.taskId, provider: task.provider, model: task.model },
      );
      await this.taskRepo.updateStatus(task.taskId, [TaskStatus.SUBMITTED, TaskStatus.PROCESSING], TaskStatus.TIMEOUT, {
        error: { code: 'POLL_TIMEOUT', message: `count=${pollCount}/${maxPollCount}, elapsed=${elapsed}ms/${maxDuration}ms`, retryable: false },
      });
      await this.timelineService.addEvent(task.taskId, TimelineEvent.TASK_TIMEOUT, { pollCount, elapsedMs: elapsed });
      this.eventEmitter.emit('system.task_timeout', buildTaskEvent(task.taskId, task.model, task.provider, 'timeout', elapsed));
      return;
    }

    const pollLimits = this.providerConfig.getPollLimitsSync(providerName);
    const qps = Math.max(1, pollLimits.maxPerSecond || 1);
    const allowed = await this.rateLimiter.acquire(
      `provider:${providerName}:poll:qps`,
      qps,
      1000,
    );
    if (!allowed) {
      await this.taskRepo.deferNextPoll(task.taskId, 1000);
      return;
    }

    let concToken: string | null = null;
    const maxConc = pollLimits.maxConcurrent;
    if (maxConc != null && maxConc > 0) {
      concToken = await this.rateLimiter.acquireConcurrent(
        `provider:${providerName}:poll:concurrent`,
        maxConc,
        120000,
      );
      if (!concToken) {
        await this.taskRepo.deferNextPoll(task.taskId, 500);
        return;
      }
    }

    await this.timelineService.addEvent(task.taskId, TimelineEvent.POLL_START, { pollCount });
    let queryResult;
    try {
      queryResult = await adapter.queryTask(providerTaskId);
    } catch (err: any) {
      ErrorLogger.logError(
        this.logger,
        err,
        { taskId: task.taskId, provider: task.provider, model: task.model, providerTaskId },
        'Query task failed',
      );
      throw err;
    } finally {
      if (concToken) {
        await this.rateLimiter.releaseConcurrent(`provider:${providerName}:poll:concurrent`, concToken);
      }
    }
    await this.timelineService.addEvent(task.taskId, TimelineEvent.POLL_RESULT, { providerStatus: queryResult.status, progress: queryResult.progress });

    switch (queryResult.status) {
      case 'succeeded': {
        const completedAt = new Date();
        await this.timingService.recordTiming(task.taskId, 'providerCompletedAt', completedAt);
        await this.timingService.recordTiming(task.taskId, 'completedAt', completedAt);
        await this.timingService.calculateAndSave(task.taskId);
        await this.taskRepo.updateStatus(task.taskId, [TaskStatus.SUBMITTED, TaskStatus.PROCESSING], TaskStatus.SUCCESS, { resultPayload: queryResult.result });
        const e2eMs = completedAt.getTime() - (task as any).createdAt.getTime();
        this.metrics.taskCompletedTotal.inc({ feature_type: task.featureType, provider: task.provider, status: 'SUCCESS' });
        this.metrics.taskDuration.observe({ feature_type: task.featureType, provider: task.provider }, e2eMs);
        await this.timelineService.addEvent(task.taskId, TimelineEvent.TASK_SUCCESS, { totalE2eMs: e2eMs });
        this.eventEmitter.emit('system.task_success', buildTaskEvent(task.taskId, task.model, task.provider, 'success', e2eMs));
        if (task.callback?.url) await this.callbackQueue.add('deliver', { taskId: task.taskId, callbackUrl: task.callback.url, callbackSecret: task.callback.secret });
        break;
      }
      case 'failed':
        ErrorLogger.logError(
          this.logger,
          new Error(queryResult.error?.message || 'Provider task failed'),
          { 
            taskId: task.taskId, 
            provider: task.provider, 
            model: task.model,
            providerTaskId,
            errorCode: queryResult.error?.code || 'PROVIDER_FAILED',
          },
          'Provider task failed',
        );
        await this.taskRepo.updateStatus(task.taskId, [TaskStatus.SUBMITTED, TaskStatus.PROCESSING], TaskStatus.FAILED, {
          error: { code: queryResult.error?.code || 'PROVIDER_FAILED', message: queryResult.error?.message || 'Provider failed', retryable: false },
        });
        this.metrics.taskFailedTotal.inc({ feature_type: task.featureType, provider: task.provider, error_code: queryResult.error?.code || 'PROVIDER_FAILED' });
        await this.timelineService.addEvent(task.taskId, TimelineEvent.TASK_FAILED, { errorCode: queryResult.error?.code });
        this.eventEmitter.emit('system.task_failed', buildTaskEvent(task.taskId, task.model, task.provider, 'failed', Date.now() - (task as any).createdAt.getTime()));
        this.eventEmitter.emit('system.provider_error', buildProviderEvent(task.provider, queryResult.error?.code || 'PROVIDER_FAILED', queryResult.error?.message || 'Provider failed'));
        break;
      case 'processing':
        if (task.status === TaskStatus.SUBMITTED) await this.taskRepo.updateStatus(task.taskId, TaskStatus.SUBMITTED, TaskStatus.PROCESSING);
        await this.scheduleNextPoll(task.taskId, task.polling?.pollInterval ?? this.config.polling.defaultIntervalMs);
        break;
      default:
        await this.scheduleNextPoll(task.taskId, task.polling?.pollInterval ?? this.config.polling.defaultIntervalMs);
    }
  }

  private async scheduleNextPoll(taskId: string, currentInterval: number): Promise<void> {
    const nextInterval = Math.min(Math.floor(currentInterval * 1.2), this.config.polling.maxIntervalMs);
    await this.taskRepo.incrementPollCount(taskId, new Date(Date.now() + nextInterval), nextInterval);
  }
}
