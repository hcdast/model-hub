import { Injectable, Inject, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { MetricsService } from '../observability/metrics.service';
import { CallOutcome } from './interfaces/call-outcome.interface';
import { HealthMetrics } from './interfaces/health-metrics.interface';

/**
 * 健康指标采集器
 * 负责在 submit 和 query/poll 路径上采集 Provider API 调用结果，
 * 写入 Redis 滑动窗口，计算实时健康指标。
 */
@Injectable()
export class HealthMetricsCollector {
  private readonly logger = new Logger(HealthMetricsCollector.name);

  /** Redis Sorted Set key 前缀 */
  private readonly keyPrefix = 'health:window:';

  /** 默认滑动窗口时长（毫秒），Task 4 实现 CircuitBreakerConfigService 后替换 */
  private readonly defaultSlidingWindowDurationMs = 300000;

  /** 默认最小样本数 */
  private readonly defaultMinSampleCount = 10;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly metricsService: MetricsService,
  ) {}

  /**
   * 记录一次 Provider API 调用结果
   * 使用 ZADD 写入 Redis Sorted Set，fire-and-forget 模式，不阻塞主流程
   * Redis 不可用时静默丢弃，记录 warning 日志
   * 记录后异步更新 Prometheus 健康指标 gauge
   *
   * @param outcome 调用结果
   */
  async recordOutcome(outcome: CallOutcome): Promise<void> {
    const timestamp = outcome.timestamp
      ? outcome.timestamp.getTime()
      : Date.now();
    const key = `${this.keyPrefix}${outcome.provider}`;

    // 构造紧凑 JSON member，添加随机后缀确保唯一性
    const member = JSON.stringify({
      s: outcome.success ? 1 : 0,
      l: outcome.latencyMs,
      e: outcome.errorCode || '',
      _t: timestamp,
      _r: Math.random().toString(36).slice(2, 8),
    });

    // fire-and-forget：异步执行 Redis 写入，不 await，不阻塞主流程
    this.redis
      .zadd(key, timestamp.toString(), member)
      .then(() => {
        // 写入成功后异步更新 Prometheus 健康指标 gauge
        this.updateHealthGauges(outcome.provider);
      })
      .catch((err: Error) => {
        this.logger.warn(
          `Redis 不可用，Provider ${outcome.provider} 健康指标记录丢弃: ${err.message}`,
        );
      });
  }

  /**
   * 异步更新 Prometheus 健康指标 gauge
   * 在 recordOutcome 写入 Redis 成功后调用，不阻塞主流程
   *
   * @param provider Provider 名称
   */
  private updateHealthGauges(provider: string): void {
    this.getMetrics(provider)
      .then((metrics) => {
        // 仅在样本数足够时更新 gauge
        if (metrics.sampleCount >= this.defaultMinSampleCount) {
          this.metricsService.providerHealthSuccessRate
            .labels(provider)
            .set(metrics.successRate);
          this.metricsService.providerHealthErrorRate
            .labels(provider)
            .set(metrics.errorRate);
          this.metricsService.providerHealthAvgLatencyMs
            .labels(provider)
            .set(metrics.avgLatencyMs);
        }
      })
      .catch((err: Error) => {
        this.logger.warn(
          `Provider ${provider} Prometheus 健康指标更新失败: ${err.message}`,
        );
      });
  }

  /**
   * 获取指定 Provider 的当前健康指标
   * 使用 ZRANGEBYSCORE 查询滑动窗口内的数据点，计算 successRate, errorRate, avgLatencyMs
   * 当样本数 < minSampleCount 时，返回 sampleCount 但指标为 0（调用方通过 sampleCount 判断 UNKNOWN）
   *
   * @param provider Provider 名称
   * @returns 健康指标
   */
  async getMetrics(provider: string): Promise<HealthMetrics> {
    const now = Date.now();
    const windowStart = now - this.defaultSlidingWindowDurationMs;
    const key = `${this.keyPrefix}${provider}`;

    try {
      // 查询滑动窗口内的所有数据点
      const members = await this.redis.zrangebyscore(
        key,
        windowStart,
        now,
      );

      const sampleCount = members.length;

      // 样本数不足时，返回零值指标，调用方通过 sampleCount 判断 UNKNOWN
      if (sampleCount < this.defaultMinSampleCount) {
        return {
          provider,
          successRate: 0,
          errorRate: 0,
          avgLatencyMs: 0,
          sampleCount,
          windowDurationMs: this.defaultSlidingWindowDurationMs,
          computedAt: new Date(),
        };
      }

      // 解析数据点并计算指标
      let successCount = 0;
      let totalLatency = 0;

      for (const member of members) {
        try {
          const data = JSON.parse(member);
          if (data.s === 1) {
            successCount++;
          }
          totalLatency += data.l || 0;
        } catch {
          // 跳过无法解析的数据点
          this.logger.warn(
            `Provider ${provider} 滑动窗口数据点解析失败，已跳过`,
          );
        }
      }

      const successRate = successCount / sampleCount;
      const errorRate = (sampleCount - successCount) / sampleCount;
      const avgLatencyMs = totalLatency / sampleCount;

      return {
        provider,
        successRate,
        errorRate,
        avgLatencyMs,
        sampleCount,
        windowDurationMs: this.defaultSlidingWindowDurationMs,
        computedAt: new Date(),
      };
    } catch (err) {
      this.logger.warn(
        `Redis 不可用，Provider ${provider} 健康指标计算失败: ${(err as Error).message}`,
      );
      // Redis 不可用时返回零值指标
      return {
        provider,
        successRate: 0,
        errorRate: 0,
        avgLatencyMs: 0,
        sampleCount: 0,
        windowDurationMs: this.defaultSlidingWindowDurationMs,
        computedAt: new Date(),
      };
    }
  }

  /**
   * 清理指定 Provider 的过期滑动窗口数据
   * 使用 ZREMRANGEBYSCORE 移除窗口外的数据点
   *
   * @param provider Provider 名称
   */
  async cleanExpiredData(provider: string): Promise<void> {
    const windowStart = Date.now() - this.defaultSlidingWindowDurationMs;
    const key = `${this.keyPrefix}${provider}`;

    try {
      await this.redis.zremrangebyscore(key, '-inf', windowStart - 1);
    } catch (err) {
      this.logger.warn(
        `Redis 不可用，Provider ${provider} 过期数据清理失败: ${(err as Error).message}`,
      );
    }
  }

  /**
   * 获取所有 Provider 的健康指标
   * 通过 Redis SCAN 命令扫描 health:window:* 前缀获取所有 Provider 名称，
   * 避免依赖 ProviderRegistry
   *
   * @returns 所有 Provider 的健康指标数组
   */
  async getAllMetrics(): Promise<HealthMetrics[]> {
    try {
      const providers = await this.scanProviderKeys();
      const metricsPromises = providers.map((provider) =>
        this.getMetrics(provider),
      );
      return await Promise.all(metricsPromises);
    } catch (err) {
      this.logger.warn(
        `获取所有 Provider 健康指标失败: ${(err as Error).message}`,
      );
      return [];
    }
  }

  /**
   * 使用 Redis SCAN 命令扫描所有 health:window:* 前缀的 key，
   * 提取 Provider 名称列表
   *
   * @returns Provider 名称数组
   */
  private async scanProviderKeys(): Promise<string[]> {
    const pattern = `${this.keyPrefix}*`;
    const providers: string[] = [];
    let cursor = '0';

    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100,
      );
      cursor = nextCursor;

      for (const key of keys) {
        // 从 key 中提取 Provider 名称
        const provider = key.slice(this.keyPrefix.length);
        if (provider && !providers.includes(provider)) {
          providers.push(provider);
        }
      }
    } while (cursor !== '0');

    return providers;
  }
}
