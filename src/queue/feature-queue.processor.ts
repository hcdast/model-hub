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
import { HealthMetricsCollector } from '../provider-health/health-metrics-collector.service';
import { CircuitBreakerService } from '../provider-health/circuit-breaker.service';
import { TaskStatus } from '../common/constants/task-status';
import { APP_CONFIG } from '../config/config.module';
import { AppConfig } from '../config/interfaces/config.interface';
import { QueueRegistryService } from './queue-registry.service';
import { TaskSubmitJobData } from './task-submit.processor';
import { Processor, Process } from '@nestjs/bull';
import { ErrorLogger } from '../common/utils/error-logger.util';
import { buildTaskEvent, buildProviderEvent } from '../notification/events/event-emitter.helper';
import { BillingAdapter } from '../billing/billing.adapter';
import { PricingService } from '../billing/pricing.service';
import { UsageType } from '../billing/interfaces/billing.interface';

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
    private readonly healthMetricsCollector: HealthMetricsCollector,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @InjectQueue('callback') private readonly callbackQueue: Queue,
    private readonly queueRegistry: QueueRegistryService,
    private readonly billingAdapter: BillingAdapter,
    private readonly pricingService: PricingService,
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

      const latencyMs = Date.now() - providerStart;

      this.metrics.providerRequestDuration.observe(
        { provider: providerName, operation: 'submit' },
        latencyMs,
      );

      // 异步采集健康指标，不阻塞任务处理
      this.collectHealthMetrics(providerName, true, latencyMs, undefined);

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

        // 计费结算：同步任务完成，从供应商结果中提取实际用量并结算
        try {
          const actualUsage = await this.extractActualUsage(task.model, result.result);
          await this.billingAdapter.settle({
            taskId,
            actualUsage,
            resultPayload: result.result,
          });
        } catch (billingErr: any) {
          this.logger.error(
            `计费结算失败（同步任务）：taskId=${taskId}`,
            billingErr instanceof Error ? billingErr.stack : billingErr,
          );
        }

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
      const latencyMs = Date.now() - providerStart;

      this.metrics.providerRequestDuration.observe(
        { provider: providerName, operation: 'submit' },
        latencyMs,
      );

      const mapped = adapter.mapError(err);

      // 异步采集健康指标，不阻塞任务处理
      this.collectHealthMetrics(providerName, false, latencyMs, mapped.code);
      
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

        // 计费退款：不可重试的提交失败，退还预扣费用
        try {
          await this.billingAdapter.refund({ taskId, reason: 'provider_submit_failed' });
        } catch (billingErr: any) {
          this.logger.error(
            `计费退款失败（提交失败）：taskId=${taskId}`,
            billingErr instanceof Error ? billingErr.stack : billingErr,
          );
        }

        return;
      }
      throw err;
    } finally {
      if (concToken) {
        await this.rateLimiter.releaseConcurrent(`provider:${providerName}:concurrent`, concToken);
      }
    }
  }

  /**
   * 从供应商返回结果中提取实际用量
   *
   * 根据模型的 usageType 从 result 中提取对应的用量值：
   * - token：提取 usage.total_tokens 或 input_tokens + output_tokens
   * - count：提取 batch_quantity 或默认 1
   * - duration：提取 duration（秒）或默认 1
   */
  private async extractActualUsage(
    model: string,
    result?: Record<string, any>,
  ): Promise<{ usageType: UsageType; usageValue: number }> {
    const { usageType } = await this.pricingService.getUnitPrice(model);

    let usageValue: number;

    switch (usageType) {
      case UsageType.TOKEN: {
        // LLM 类型：从 usage 字段提取 token 数
        const usage = result?.usage;
        if (usage?.total_tokens && typeof usage.total_tokens === 'number') {
          usageValue = usage.total_tokens;
        } else if (usage?.input_tokens || usage?.output_tokens) {
          usageValue = (Number(usage.input_tokens) || 0) + (Number(usage.output_tokens) || 0);
        } else if (usage?.prompt_tokens || usage?.completion_tokens) {
          // 兼容 OpenAI 格式
          usageValue = (Number(usage.prompt_tokens) || 0) + (Number(usage.completion_tokens) || 0);
        } else {
          usageValue = 1;
        }
        break;
      }
      case UsageType.COUNT:
        // 图像类型：从结果中提取数量
        usageValue = Number(result?.batch_quantity) || Number(result?.image_count) || 1;
        break;
      case UsageType.DURATION:
        // 视频类型：从结果中提取时长（秒）
        usageValue = Number(result?.duration) || Number(result?.video_duration) || 1;
        break;
      default:
        usageValue = 1;
    }

    return { usageType, usageValue };
  }

  /**
   * 异步采集健康指标并触发熔断器评估
   * fire-and-forget 模式，不阻塞任务处理
   */
  private collectHealthMetrics(
    provider: string,
    success: boolean,
    latencyMs: number,
    errorCode?: string,
  ): void {
    // recordOutcome 内部已是 fire-and-forget，不阻塞
    this.healthMetricsCollector.recordOutcome({
      provider,
      success,
      latencyMs,
      errorCode,
      path: 'submit',
    });

    // 异步更新连续失败计数并触发熔断器状态评估
    Promise.resolve().then(async () => {
      try {
        await this.circuitBreaker.recordResult(provider, success);
        const metrics = await this.healthMetricsCollector.getMetrics(provider);
        await this.circuitBreaker.evaluate(provider, metrics);
      } catch (err) {
        this.logger.warn(
          `Provider ${provider} 健康指标采集或熔断器评估失败: ${(err as Error).message}`,
        );
      }
    });
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
