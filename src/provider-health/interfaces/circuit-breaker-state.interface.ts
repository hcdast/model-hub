/**
 * 熔断器状态枚举
 * CLOSED: 正常运行，所有请求放行
 * OPEN: 熔断触发，请求被拦截
 * HALF_OPEN: 恢复试探，有限请求放行
 */
export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

/**
 * 熔断器完整状态（存储在 Redis 中）
 */
export interface CircuitBreakerState {
  /** 当前熔断状态 */
  state: CircuitState;

  /** 熔断器打开时间（ISO 8601），CLOSED 时为 null */
  openedAt: string | null;

  /** 最后一次状态转换时间（ISO 8601） */
  lastTransitionAt: string;

  /** 连续失败次数 */
  consecutiveFailures: number;

  /** HALF_OPEN 状态下探针成功次数 */
  probeSuccesses: number;

  /** 手动覆盖信息（管理员手动设置时非 null） */
  manualOverride: {
    /** 手动设置的目标状态（仅允许 OPEN 或 CLOSED） */
    state: CircuitState;
    /** 操作人 */
    operator: string;
    /** 操作时间（ISO 8601） */
    timestamp: string;
  } | null;
}
