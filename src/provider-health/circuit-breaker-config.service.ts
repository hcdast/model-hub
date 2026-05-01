import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ProviderRuntimeConfig,
  ProviderRuntimeConfigDocument,
} from '../database/schemas/provider-runtime-config.schema';
import { CircuitBreakerConfig } from './interfaces/circuit-breaker-config.interface';

/**
 * 熔断器配置校验结果
 */
export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * 熔断器配置管理服务
 * 负责读取、校验和更新每个 Provider 的熔断器配置
 * 支持按 Provider 覆盖系统默认值
 */
@Injectable()
export class CircuitBreakerConfigService {
  private readonly logger = new Logger(CircuitBreakerConfigService.name);

  constructor(
    @InjectModel(ProviderRuntimeConfig.name)
    private readonly providerRuntimeConfigModel: Model<ProviderRuntimeConfigDocument>,
  ) {}

  /**
   * 获取系统默认熔断器配置
   */
  getDefaultConfig(): CircuitBreakerConfig {
    return {
      errorRateThreshold: 50,
      consecutiveFailureThreshold: 5,
      cooldownDurationMs: 30000,
      probeRequestCount: 3,
      slidingWindowDurationMs: 300000,
      minSampleCount: 10,
    };
  }

  /**
   * 获取指定 Provider 的熔断器配置
   * 从 provider_runtime_configs 读取 circuit_breaker 字段，与默认值合并
   * 配置读取失败时回退到默认值，记录 warning 日志
   */
  async getConfig(provider: string): Promise<CircuitBreakerConfig> {
    const defaultConfig = this.getDefaultConfig();

    try {
      const doc = await this.providerRuntimeConfigModel
        .findOne({ provider_name: provider })
        .lean()
        .exec();

      if (!doc || !doc.circuit_breaker) {
        return defaultConfig;
      }

      const cb = doc.circuit_breaker;

      // 将 MongoDB 中的 snake_case 字段转换为 camelCase，与默认值合并
      return {
        errorRateThreshold:
          cb.error_rate_threshold ?? defaultConfig.errorRateThreshold,
        consecutiveFailureThreshold:
          cb.consecutive_failure_threshold ?? defaultConfig.consecutiveFailureThreshold,
        cooldownDurationMs:
          cb.cooldown_duration_ms ?? defaultConfig.cooldownDurationMs,
        probeRequestCount:
          cb.probe_request_count ?? defaultConfig.probeRequestCount,
        slidingWindowDurationMs:
          cb.sliding_window_duration_ms ?? defaultConfig.slidingWindowDurationMs,
        minSampleCount:
          cb.min_sample_count ?? defaultConfig.minSampleCount,
      };
    } catch (err) {
      this.logger.warn(
        `读取 Provider "${provider}" 熔断器配置失败，回退到默认值: ${(err as Error).message}`,
      );
      return defaultConfig;
    }
  }

  /**
   * 校验熔断器配置值
   * - error_rate_threshold 必须在 [1, 100] 范围内
   * - cooldown_duration_ms 必须在 [5000, 300000] 范围内
   * - 所有整数参数必须为正数
   */
  validateConfig(config: Partial<CircuitBreakerConfig>): ConfigValidationResult {
    const errors: string[] = [];

    // 校验 errorRateThreshold
    if (config.errorRateThreshold !== undefined) {
      if (
        !Number.isInteger(config.errorRateThreshold) ||
        config.errorRateThreshold < 1 ||
        config.errorRateThreshold > 100
      ) {
        errors.push('errorRateThreshold 必须为 1 到 100 之间的整数');
      }
    }

    // 校验 consecutiveFailureThreshold
    if (config.consecutiveFailureThreshold !== undefined) {
      if (
        !Number.isInteger(config.consecutiveFailureThreshold) ||
        config.consecutiveFailureThreshold < 1
      ) {
        errors.push('consecutiveFailureThreshold 必须为正整数');
      }
    }

    // 校验 cooldownDurationMs
    if (config.cooldownDurationMs !== undefined) {
      if (
        !Number.isInteger(config.cooldownDurationMs) ||
        config.cooldownDurationMs < 5000 ||
        config.cooldownDurationMs > 300000
      ) {
        errors.push('cooldownDurationMs 必须为 5000 到 300000 之间的整数');
      }
    }

    // 校验 probeRequestCount
    if (config.probeRequestCount !== undefined) {
      if (
        !Number.isInteger(config.probeRequestCount) ||
        config.probeRequestCount < 1
      ) {
        errors.push('probeRequestCount 必须为正整数');
      }
    }

    // 校验 slidingWindowDurationMs
    if (config.slidingWindowDurationMs !== undefined) {
      if (
        !Number.isInteger(config.slidingWindowDurationMs) ||
        config.slidingWindowDurationMs < 1
      ) {
        errors.push('slidingWindowDurationMs 必须为正整数');
      }
    }

    // 校验 minSampleCount
    if (config.minSampleCount !== undefined) {
      if (
        !Number.isInteger(config.minSampleCount) ||
        config.minSampleCount < 1
      ) {
        errors.push('minSampleCount 必须为正整数');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * 更新指定 Provider 的熔断器配置
   * 校验后将 camelCase 配置转换为 snake_case 写入 MongoDB
   * 校验失败时抛出错误
   */
  async updateConfig(
    provider: string,
    config: Partial<CircuitBreakerConfig>,
  ): Promise<void> {
    // 先校验配置
    const validation = this.validateConfig(config);
    if (!validation.valid) {
      throw new Error(
        `熔断器配置校验失败: ${validation.errors.join('; ')}`,
      );
    }

    // 将 camelCase 转换为 snake_case 写入 MongoDB
    const updateFields: Record<string, unknown> = {};

    if (config.errorRateThreshold !== undefined) {
      updateFields['circuit_breaker.error_rate_threshold'] =
        config.errorRateThreshold;
    }
    if (config.consecutiveFailureThreshold !== undefined) {
      updateFields['circuit_breaker.consecutive_failure_threshold'] =
        config.consecutiveFailureThreshold;
    }
    if (config.cooldownDurationMs !== undefined) {
      updateFields['circuit_breaker.cooldown_duration_ms'] =
        config.cooldownDurationMs;
    }
    if (config.probeRequestCount !== undefined) {
      updateFields['circuit_breaker.probe_request_count'] =
        config.probeRequestCount;
    }
    if (config.slidingWindowDurationMs !== undefined) {
      updateFields['circuit_breaker.sliding_window_duration_ms'] =
        config.slidingWindowDurationMs;
    }
    if (config.minSampleCount !== undefined) {
      updateFields['circuit_breaker.min_sample_count'] =
        config.minSampleCount;
    }

    await this.providerRuntimeConfigModel.updateOne(
      { provider_name: provider },
      { $set: updateFields },
      { upsert: true },
    );
  }
}
