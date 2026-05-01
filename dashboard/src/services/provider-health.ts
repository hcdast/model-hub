import api from './api';

/** Provider 健康概览数据 */
export interface ProviderHealthOverview {
  provider: string;
  circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  successRate: number;
  avgLatencyMs: number;
  errorRate: number;
  sampleCount: number;
  lastTransitionAt: string;
  hasManualOverride: boolean;
}

/** Provider 详细健康信息 */
export interface ProviderHealthDetail extends ProviderHealthOverview {
  consecutiveFailures: number;
  probeSuccesses: number;
  manualOverride: {
    state: 'CLOSED' | 'OPEN';
    operator: string;
    timestamp: string;
  } | null;
  windowDurationMs: number;
}

/** 历史指标时间序列数据点 */
export interface HealthHistoryPoint {
  timestamp: string;
  successRate: number;
  errorRate: number;
  avgLatencyMs: number;
  sampleCount: number;
}

/** 历史指标响应 */
export interface ProviderHealthHistory {
  provider: string;
  points: HealthHistoryPoint[];
}

/** 熔断器配置 */
export interface CircuitBreakerConfig {
  error_rate_threshold: number;
  consecutive_failure_threshold: number;
  cooldown_duration_ms: number;
  probe_request_count: number;
  sliding_window_duration_ms: number;
  min_sample_count: number;
}

/** Provider 健康监控 API */
export const providerHealthApi = {
  /** 获取所有 Provider 的健康概览 */
  getOverview: () =>
    api.get<any, any>('/provider-health/overview'),

  /** 获取单个 Provider 的详细健康信息 */
  getProviderHealth: (provider: string) =>
    api.get<any, any>(`/provider-health/${encodeURIComponent(provider)}`),

  /** 获取 Provider 的历史指标时间序列 */
  getHistory: (provider: string, hours: number = 1) =>
    api.get<any, any>(`/provider-health/${encodeURIComponent(provider)}/history`, {
      params: { hours },
    }),

  /** 手动覆盖熔断器状态 */
  overrideCircuitBreaker: (provider: string, state: 'OPEN' | 'CLOSED') =>
    api.post(`/provider-health/${encodeURIComponent(provider)}/circuit-breaker/override`, {
      state,
    }),

  /** 清除手动覆盖 */
  clearOverride: (provider: string) =>
    api.delete(`/provider-health/${encodeURIComponent(provider)}/circuit-breaker/override`),

  /** 更新熔断器配置 */
  updateConfig: (provider: string, config: Partial<CircuitBreakerConfig>) =>
    api.put(`/provider-health/${encodeURIComponent(provider)}/circuit-breaker/config`, config),

  /** 获取熔断器配置 */
  getConfig: (provider: string) =>
    api.get<any, any>(`/provider-health/${encodeURIComponent(provider)}/circuit-breaker/config`),
};
