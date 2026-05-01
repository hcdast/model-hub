/**
 * 熔断器配置接口
 * 支持按 Provider 独立配置，未配置时使用系统默认值
 */
export interface CircuitBreakerConfig {
  /** 错误率阈值（1-100），超过此值触发熔断，默认 50 */
  errorRateThreshold: number;

  /** 连续失败次数阈值，超过此值触发熔断，默认 5 */
  consecutiveFailureThreshold: number;

  /** 冷却时间（毫秒），OPEN 状态持续此时长后转为 HALF_OPEN，默认 30000 */
  cooldownDurationMs: number;

  /** 探针请求数量，HALF_OPEN 状态下允许通过的请求数，默认 3 */
  probeRequestCount: number;

  /** 滑动窗口时长（毫秒），用于计算健康指标的时间范围，默认 300000 */
  slidingWindowDurationMs: number;

  /** 最小样本数，窗口内样本不足此值时不触发熔断，默认 10 */
  minSampleCount: number;
}
