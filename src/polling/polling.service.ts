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
import { HealthMetricsCollector } from '../provider-health/health-metrics-collector.service';
import { CircuitBreakerService } from '../provider-health/circuit-breaker.service';
import { TaskDocument } from '../database/schemas/task.schema';
import { RateLimiterService } from '../redis/rate-limiter.service';
import { ErrorLogger } from '../common/utils/error-logger.util';
import { buildTaskEvent, buildProviderEvent } from '../notification/events/event-emitter.helper';
import { BillingAdapter } from '../billing/billing.adapter';
import { PricingService } from '../billing/pricing.service';
import { UsageType } from '../billing/interfaces/billing.interface';
import { UsageTrackerService } from '../api-client/usage-tracker.service';

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
    private readonly healthMetricsCollector: HealthMetricsCollector,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly rateLimiter: RateLimiterService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @InjectQueue('callback') private readonly callbackQueue: Queue,
    private readonly billingAdapter: BillingAdapter,
    private readonly pricingService: PricingService,
    private readonly usageTracker: UsageTrackerService,
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

      // 计费退款：超时任务退还预扣费用
      try {
        await this.billingAdapter.refund({ taskId: task.taskId, reason: 'poll_timeout' });
      } catch (billingErr: any) {
        this.logger.error(
          `计费退款失败（超时）：taskId=${task.taskId}`,
          billingErr instanceof Error ? billingErr.stack : billingErr,
        );
      }

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
    const queryStartMs = Date.now();
    try {
      queryResult = await adapter.queryTask(providerTaskId);
    } catch (err: any) {
      const latencyMs = Date.now() - queryStartMs;

      if (concToken) {
        await this.rateLimiter.releaseConcurrent(`provider:${providerName}:poll:concurrent`, concToken);
        concToken = null;
      }

      // 利用 adapter.mapError 判断是否可重试
      const mapped = adapter.mapError(err);
      ErrorLogger.logError(
        this.logger,
        err,
        { taskId: task.taskId, provider: task.provider, model: task.model, providerTaskId, retryable: mapped.retryable },
        'Query task failed',
      );

      // 异步采集健康指标，不阻塞轮询处理
      this.collectHealthMetrics(providerName, false, latencyMs, mapped.code);

      if (mapped.retryable) {
        // 可重试错误（502/503/429 等）：用 deferNextPoll 推迟下次轮询，不消耗 pollCount
        const backoffMs = Math.min(
          (task.polling?.pollInterval ?? this.config.polling.defaultIntervalMs) * 2,
          this.config.polling.maxIntervalMs,
        );
        await this.taskRepo.deferNextPoll(task.taskId, backoffMs);
        await this.timelineService.addEvent(task.taskId, TimelineEvent.POLL_RESULT, {
          providerStatus: 'error', errorCode: mapped.code, retryable: true, nextRetryMs: backoffMs,
        });
        this.logger.warn(
          `Query retryable error, deferred ${backoffMs}ms | taskId=${task.taskId}, code=${mapped.code}`,
        );
      } else {
        // 不可重试错误：直接标记任务失败
        await this.taskRepo.updateStatus(
          task.taskId,
          [TaskStatus.SUBMITTED, TaskStatus.PROCESSING],
          TaskStatus.FAILED,
          { error: { code: mapped.code, message: mapped.message, retryable: false } },
        );
        this.metrics.taskFailedTotal.inc({
          feature_type: task.featureType, provider: task.provider, error_code: mapped.code,
        });
        await this.timelineService.addEvent(task.taskId, TimelineEvent.TASK_FAILED, { errorCode: mapped.code });
        this.eventEmitter.emit('system.task_failed', buildTaskEvent(task.taskId, task.model, task.provider, 'failed', Date.now() - (task as any).createdAt.getTime()));
        this.eventEmitter.emit('system.provider_error', buildProviderEvent(task.provider, mapped.code, mapped.message));

        // 计费退款：不可重试的查询错误导致任务失败
        try {
          await this.billingAdapter.refund({ taskId: task.taskId, reason: `query_error_${mapped.code}` });
        } catch (billingErr: any) {
          this.logger.error(
            `计费退款失败（查询错误）：taskId=${task.taskId}`,
            billingErr instanceof Error ? billingErr.stack : billingErr,
          );
        }

        // 异步记录 Usage 失败统计
        this.usageTracker.recordCompletion(task.clientId, false).catch((err) => {
          this.logger.warn(`Usage 记录失败: clientId=${task.clientId}, error=${(err as Error).message}`);
        });
      }
      return;
    } finally {
      if (concToken) {
        await this.rateLimiter.releaseConcurrent(`provider:${providerName}:poll:concurrent`, concToken);
      }
    }
    // 查询成功，计算延迟并异步采集健康指标
    const queryLatencyMs = Date.now() - queryStartMs;
    this.collectHealthMetrics(providerName, true, queryLatencyMs, undefined);

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

        // 计费结算：从供应商结果中提取实际用量并结算
        try {
          const actualUsage = await this.extractActualUsage(task.model, queryResult.result);
          await this.billingAdapter.settle({
            taskId: task.taskId,
            actualUsage,
            resultPayload: queryResult.result,
          });
        } catch (billingErr: any) {
          this.logger.error(
            `计费结算失败：taskId=${task.taskId}`,
            billingErr instanceof Error ? billingErr.stack : billingErr,
          );
        }

        // 异步记录 Usage 完成统计
        this.usageTracker.recordCompletion(task.clientId, true).catch((err) => {
          this.logger.warn(`Usage 记录完成失败: clientId=${task.clientId}, error=${(err as Error).message}`);
        });

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

        // 计费退款：供应商任务失败，退还预扣费用
        try {
          await this.billingAdapter.refund({ taskId: task.taskId, reason: 'provider_failed' });
        } catch (billingErr: any) {
          this.logger.error(
            `计费退款失败（供应商失败）：taskId=${task.taskId}`,
            billingErr instanceof Error ? billingErr.stack : billingErr,
          );
        }

        // 异步记录 Usage 失败统计
        this.usageTracker.recordCompletion(task.clientId, false).catch((err) => {
          this.logger.warn(`Usage 记录失败: clientId=${task.clientId}, error=${(err as Error).message}`);
        });

        break;
      case 'processing':
        if (task.status === TaskStatus.SUBMITTED) await this.taskRepo.updateStatus(task.taskId, TaskStatus.SUBMITTED, TaskStatus.PROCESSING);
        await this.scheduleNextPoll(task.taskId, task.polling?.pollInterval ?? this.config.polling.defaultIntervalMs);
        break;
      default:
        await this.scheduleNextPoll(task.taskId, task.polling?.pollInterval ?? this.config.polling.defaultIntervalMs);
    }
  }

  /**
   * 从供应商返回结果中提取实际用量
   *
   * 根据模型的 usageType 从 queryResult.result 中提取对应的用量值：
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

  private async scheduleNextPoll(taskId: string, currentInterval: number): Promise<void> {
    const nextInterval = Math.min(Math.floor(currentInterval * 1.2), this.config.polling.maxIntervalMs);
    await this.taskRepo.incrementPollCount(taskId, new Date(Date.now() + nextInterval), nextInterval);
  }

  /**
   * 异步采集健康指标并触发熔断器评估
   * fire-and-forget 模式，不阻塞轮询处理
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
      path: 'query',
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
}
