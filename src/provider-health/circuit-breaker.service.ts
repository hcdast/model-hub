import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CircuitBreakerStore } from './circuit-breaker-store.service';
import { CircuitBreakerConfigService } from './circuit-breaker-config.service';
import { HealthMetricsCollector } from './health-metrics-collector.service';
import { MetricsService } from '../observability/metrics.service';
import {
  CircuitBreakerState,
  CircuitState,
} from './interfaces/circuit-breaker-state.interface';
import { HealthMetrics } from './interfaces/health-metrics.interface';
import {
  buildCircuitOpenEvent,
  buildCircuitClosedEvent,
  buildCircuitHalfOpenEvent,
} from '../notification/events/event-emitter.helper';

/** 熔断器状态到 Prometheus gauge 数值的映射 */
const CIRCUIT_STATE_VALUE: Record<CircuitState, number> = {
  [CircuitState.CLOSED]: 0,
  [CircuitState.HALF_OPEN]: 1,
  [CircuitState.OPEN]: 2,
};

/**
 * 熔断器状态机服务
 * 管理每个 Provider 的三态熔断器（CLOSED / OPEN / HALF_OPEN），
 * 基于健康指标触发状态转换，提供请求放行判断。
 */
@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);

  constructor(
    private readonly store: CircuitBreakerStore,
    private readonly configService: CircuitBreakerConfigService,
    private readonly metricsCollector: HealthMetricsCollector,
    private readonly eventEmitter: EventEmitter2,
    private readonly metricsService: MetricsService,
  ) {}

  /**
   * 获取 Provider 的当前熔断状态
   * Store 返回 null 时视为 CLOSED（失败开放）
   */
  async getState(provider: string): Promise<CircuitState> {
    const state = await this.store.getState(provider);
    if (!state) {
      return CircuitState.CLOSED;
    }
    return state.state;
  }

  /**
   * 获取 Provider 的完整熔断器状态（含元数据）
   * Store 返回 null 时返回默认 CLOSED 状态对象
   */
  async getFullState(provider: string): Promise<CircuitBreakerState> {
    const state = await this.store.getState(provider);
    if (!state) {
      return this.buildDefaultClosedState();
    }
    return state;
  }

  /**
   * 获取所有已注册 Provider 的熔断状态
   * 通过 HealthMetricsCollector.getAllMetrics() 获取所有 Provider 名称
   */
  async getAllStates(): Promise<Map<string, CircuitBreakerState>> {
    const result = new Map<string, CircuitBreakerState>();

    // 通过健康指标采集器获取所有已注册的 Provider 名称
    const allMetrics = await this.metricsCollector.getAllMetrics();
    const providers = allMetrics.map((m) => m.provider);

    // 并行获取所有 Provider 的完整状态
    const statePromises = providers.map(async (provider) => {
      const state = await this.getFullState(provider);
      return { provider, state };
    });

    const states = await Promise.all(statePromises);
    for (const { provider, state } of states) {
      result.set(provider, state);
    }

    return result;
  }

  /**
   * 判断是否允许请求通过
   * - CLOSED: 返回 true（正常放行）
   * - OPEN: 返回 false（拒绝请求）
   * - HALF_OPEN: 当 probeSuccesses < probeRequestCount 时返回 true（允许探针请求）
   */
  async allowRequest(provider: string): Promise<boolean> {
    const state = await this.store.getState(provider);

    // null 视为 CLOSED，允许请求
    if (!state) {
      return true;
    }

    switch (state.state) {
      case CircuitState.CLOSED:
        return true;

      case CircuitState.OPEN:
        return false;

      case CircuitState.HALF_OPEN: {
        // 获取配置中的探针请求数量
        const config = await this.configService.getConfig(provider);
        return state.probeSuccesses < config.probeRequestCount;
      }

      default:
        // 未知状态，失败开放
        return true;
    }
  }

  /**
   * 评估健康指标并触发状态转换（如需要）
   * - 手动覆盖激活时跳过自动评估
   * - CLOSED 状态：error_rate > threshold 且 sampleCount >= minSampleCount → 转 OPEN
   * - CLOSED 状态：consecutiveFailures > threshold → 转 OPEN
   * - OPEN 状态：冷却到期 → 转 HALF_OPEN
   * - 使用 CAS 操作确保原子转换
   */
  async evaluate(provider: string, metrics: HealthMetrics): Promise<void> {
    const state = await this.store.getState(provider);
    const config = await this.configService.getConfig(provider);
    const ttlMs = config.cooldownDurationMs + 60000;

    // 获取当前状态，null 视为 CLOSED
    const currentState = state || this.buildDefaultClosedState();

    // 手动覆盖激活时跳过自动评估
    if (currentState.manualOverride) {
      this.logger.debug(
        `Provider ${provider} 手动覆盖激活，跳过自动评估`,
      );
      return;
    }

    const now = new Date().toISOString();

    switch (currentState.state) {
      case CircuitState.CLOSED: {
        // 检查错误率是否超过阈值（errorRate 是 0-1，threshold 是 1-100）
        const errorRateExceeded =
          metrics.sampleCount >= config.minSampleCount &&
          metrics.errorRate * 100 > config.errorRateThreshold;

        // 检查连续失败次数是否超过阈值
        const consecutiveFailureExceeded =
          currentState.consecutiveFailures > config.consecutiveFailureThreshold;

        if (errorRateExceeded || consecutiveFailureExceeded) {
          // 转换为 OPEN 状态
          const newState: CircuitBreakerState = {
            state: CircuitState.OPEN,
            openedAt: now,
            lastTransitionAt: now,
            consecutiveFailures: currentState.consecutiveFailures,
            probeSuccesses: 0,
            manualOverride: null,
          };

          const success = await this.store.compareAndSetState(
            provider,
            CircuitState.CLOSED,
            newState,
            ttlMs,
          );

          if (success) {
            this.logger.warn(
              `Provider ${provider} 熔断器 CLOSED → OPEN（errorRateExceeded=${errorRateExceeded}, consecutiveFailureExceeded=${consecutiveFailureExceeded}）`,
            );
            // 更新 Prometheus 熔断器指标
            this.metricsService.circuitBreakerState
              .labels(provider)
              .set(CIRCUIT_STATE_VALUE[CircuitState.OPEN]);
            this.metricsService.circuitBreakerTransitionsTotal
              .labels(provider, CircuitState.CLOSED, CircuitState.OPEN)
              .inc();
            // 发射 CLOSED→OPEN 状态转换事件（severity=CRITICAL）
            this.eventEmitter.emit(
              'system.provider_circuit_open',
              buildCircuitOpenEvent(provider, metrics.errorRate, currentState.consecutiveFailures, now),
            );
          }
        }
        break;
      }

      case CircuitState.OPEN: {
        // 检查冷却时间是否到期
        if (currentState.openedAt) {
          const elapsed =
            Date.now() - new Date(currentState.openedAt).getTime();

          if (elapsed >= config.cooldownDurationMs) {
            // 冷却到期，转换为 HALF_OPEN 状态
            const newState: CircuitBreakerState = {
              state: CircuitState.HALF_OPEN,
              openedAt: currentState.openedAt,
              lastTransitionAt: now,
              consecutiveFailures: currentState.consecutiveFailures,
              probeSuccesses: 0,
              manualOverride: null,
            };

            const success = await this.store.compareAndSetState(
              provider,
              CircuitState.OPEN,
              newState,
              ttlMs,
            );

            if (success) {
              this.logger.log(
                `Provider ${provider} 熔断器 OPEN → HALF_OPEN（冷却到期）`,
              );
              // 更新 Prometheus 熔断器指标
              this.metricsService.circuitBreakerState
                .labels(provider)
                .set(CIRCUIT_STATE_VALUE[CircuitState.HALF_OPEN]);
              this.metricsService.circuitBreakerTransitionsTotal
                .labels(provider, CircuitState.OPEN, CircuitState.HALF_OPEN)
                .inc();
              // 发射 OPEN→HALF_OPEN 状态转换事件（severity=WARNING）
              this.eventEmitter.emit(
                'system.provider_circuit_half_open',
                buildCircuitHalfOpenEvent(provider),
              );
            }
          }
        }
        break;
      }

      case CircuitState.HALF_OPEN:
        // HALF_OPEN 状态下不通过 evaluate 触发转换，由 recordResult 处理
        break;

      default:
        break;
    }
  }

  /**
   * 记录一次调用结果（用于连续失败计数和 HALF_OPEN 探针）
   * - 更新 consecutiveFailures（成功时重置为 0，失败时 +1）
   * - HALF_OPEN 状态：成功时 probeSuccesses++，达到 probeRequestCount 时转 CLOSED 并重置滑动窗口
   * - HALF_OPEN 状态：失败时立即转回 OPEN 并重启冷却计时器
   */
  async recordResult(provider: string, success: boolean): Promise<void> {
    const state = await this.store.getState(provider);
    const config = await this.configService.getConfig(provider);
    const ttlMs = config.cooldownDurationMs + 60000;

    // 获取当前状态，null 视为 CLOSED
    const currentState = state || this.buildDefaultClosedState();
    const now = new Date().toISOString();

    // 更新 consecutiveFailures
    const newConsecutiveFailures = success
      ? 0
      : currentState.consecutiveFailures + 1;

    switch (currentState.state) {
      case CircuitState.CLOSED: {
        // CLOSED 状态下仅更新 consecutiveFailures
        const updatedState: CircuitBreakerState = {
          ...currentState,
          consecutiveFailures: newConsecutiveFailures,
        };

        await this.store.compareAndSetState(
          provider,
          CircuitState.CLOSED,
          updatedState,
          ttlMs,
        );
        break;
      }

      case CircuitState.OPEN: {
        // OPEN 状态下仅更新 consecutiveFailures
        const updatedState: CircuitBreakerState = {
          ...currentState,
          consecutiveFailures: newConsecutiveFailures,
        };

        await this.store.compareAndSetState(
          provider,
          CircuitState.OPEN,
          updatedState,
          ttlMs,
        );
        break;
      }

      case CircuitState.HALF_OPEN: {
        if (success) {
          // 探针成功
          const newProbeSuccesses = currentState.probeSuccesses + 1;

          if (newProbeSuccesses >= config.probeRequestCount) {
            // 所有探针请求成功，转换为 CLOSED 状态
            const newState: CircuitBreakerState = {
              state: CircuitState.CLOSED,
              openedAt: null,
              lastTransitionAt: now,
              consecutiveFailures: 0,
              probeSuccesses: 0,
              manualOverride: null,
            };

            const casSuccess = await this.store.compareAndSetState(
              provider,
              CircuitState.HALF_OPEN,
              newState,
              ttlMs,
            );

            if (casSuccess) {
              this.logger.log(
                `Provider ${provider} 熔断器 HALF_OPEN → CLOSED（探针全部成功）`,
              );
              // 重置滑动窗口
              await this.metricsCollector.cleanExpiredData(provider);
              // 更新 Prometheus 熔断器指标
              this.metricsService.circuitBreakerState
                .labels(provider)
                .set(CIRCUIT_STATE_VALUE[CircuitState.CLOSED]);
              this.metricsService.circuitBreakerTransitionsTotal
                .labels(provider, CircuitState.HALF_OPEN, CircuitState.CLOSED)
                .inc();
              // 发射 *→CLOSED 状态转换事件（severity=INFO）
              this.eventEmitter.emit(
                'system.provider_circuit_closed',
                buildCircuitClosedEvent(provider, now),
              );
            }
          } else {
            // 探针成功但未达到阈值，更新 probeSuccesses
            const updatedState: CircuitBreakerState = {
              ...currentState,
              consecutiveFailures: 0,
              probeSuccesses: newProbeSuccesses,
            };

            await this.store.compareAndSetState(
              provider,
              CircuitState.HALF_OPEN,
              updatedState,
              ttlMs,
            );
          }
        } else {
          // 探针失败，立即转回 OPEN 并重启冷却计时器
          const newState: CircuitBreakerState = {
            state: CircuitState.OPEN,
            openedAt: now, // 重启冷却计时器
            lastTransitionAt: now,
            consecutiveFailures: newConsecutiveFailures,
            probeSuccesses: 0,
            manualOverride: null,
          };

          const casSuccess = await this.store.compareAndSetState(
            provider,
            CircuitState.HALF_OPEN,
            newState,
            ttlMs,
          );

          if (casSuccess) {
            this.logger.warn(
              `Provider ${provider} 熔断器 HALF_OPEN → OPEN（探针失败，重启冷却计时器）`,
            );
            // 更新 Prometheus 熔断器指标
            this.metricsService.circuitBreakerState
              .labels(provider)
              .set(CIRCUIT_STATE_VALUE[CircuitState.OPEN]);
            this.metricsService.circuitBreakerTransitionsTotal
              .labels(provider, CircuitState.HALF_OPEN, CircuitState.OPEN)
              .inc();
            // 发射 CLOSED→OPEN 状态转换事件（severity=CRITICAL）
            this.eventEmitter.emit(
              'system.provider_circuit_open',
              buildCircuitOpenEvent(provider, 0, newConsecutiveFailures, now),
            );
          }
        }
        break;
      }

      default:
        break;
    }
  }

  /**
   * 手动覆盖熔断器状态
   * 仅允许设置为 OPEN 或 CLOSED（不允许 HALF_OPEN）
   * 设置后 state 字段也更新为对应状态，evaluate() 跳过自动状态转换
   * 使用 store.setState（非 CAS）写入，因为手动覆盖是管理员显式操作
   */
  async manualOverride(
    provider: string,
    state: CircuitState,
    operator: string,
  ): Promise<void> {
    // 仅允许 OPEN 或 CLOSED
    if (state !== CircuitState.OPEN && state !== CircuitState.CLOSED) {
      throw new Error(
        `手动覆盖仅允许设置为 OPEN 或 CLOSED，收到: ${state}`,
      );
    }

    const config = await this.configService.getConfig(provider);
    const ttlMs = config.cooldownDurationMs + 60000;
    const now = new Date().toISOString();

    // 获取当前状态
    const currentState = await this.store.getState(provider);
    const baseState = currentState || this.buildDefaultClosedState();

    // 构建新状态：state 字段更新为覆盖目标状态
    const newState: CircuitBreakerState = {
      ...baseState,
      state,
      lastTransitionAt: now,
      openedAt: state === CircuitState.OPEN ? now : null,
      // OPEN 时保留 consecutiveFailures，CLOSED 时重置
      consecutiveFailures:
        state === CircuitState.CLOSED ? 0 : baseState.consecutiveFailures,
      probeSuccesses: 0,
      manualOverride: {
        state,
        operator,
        timestamp: now,
      },
    };

    // 使用 setState（非 CAS）写入，管理员显式操作
    await this.store.setState(provider, newState, ttlMs);

    this.logger.warn(
      `Provider ${provider} 熔断器被手动覆盖为 ${state}，操作人: ${operator}`,
    );
  }

  /**
   * 清除手动覆盖，恢复自动熔断
   * 清除 manualOverride 字段后，state 保持当前值（不自动恢复）
   */
  async clearOverride(provider: string): Promise<void> {
    const config = await this.configService.getConfig(provider);
    const ttlMs = config.cooldownDurationMs + 60000;

    // 获取当前状态
    const currentState = await this.store.getState(provider);
    if (!currentState) {
      // 无状态，无需清除
      return;
    }

    // 清除 manualOverride 字段，state 保持当前值
    const newState: CircuitBreakerState = {
      ...currentState,
      manualOverride: null,
    };

    // 使用 setState（非 CAS）写入
    await this.store.setState(provider, newState, ttlMs);

    this.logger.log(
      `Provider ${provider} 手动覆盖已清除，恢复自动熔断`,
    );
  }

  /**
   * 构建默认 CLOSED 状态对象
   */
  private buildDefaultClosedState(): CircuitBreakerState {
    return {
      state: CircuitState.CLOSED,
      openedAt: null,
      lastTransitionAt: new Date().toISOString(),
      consecutiveFailures: 0,
      probeSuccesses: 0,
      manualOverride: null,
    };
  }
}
