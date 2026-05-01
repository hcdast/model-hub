/**
 * 从滑动窗口计算出的 Provider 健康指标
 */
export interface HealthMetrics {
  /** Provider 名称 */
  provider: string;

  /** 成功率（0-1），成功调用数 / 总调用数 */
  successRate: number;

  /** 错误率（0-1），失败调用数 / 总调用数 */
  errorRate: number;

  /** 平均响应延迟（毫秒） */
  avgLatencyMs: number;

  /** 滑动窗口内的样本数量 */
  sampleCount: number;

  /** 滑动窗口时长（毫秒） */
  windowDurationMs: number;

  /** 指标计算时间 */
  computedAt: Date;
}

/**
 * Provider 健康状态（样本不足时为 UNKNOWN）
 */
export type HealthStatus = 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' | 'UNKNOWN';
