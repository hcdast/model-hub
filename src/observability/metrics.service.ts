import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  Registry,
  Counter,
  Histogram,
  Gauge,
  collectDefaultMetrics,
} from 'prom-client';

@Injectable()
export class MetricsService implements OnModuleInit {
  readonly registry = new Registry();

  readonly taskCreatedTotal: Counter;
  readonly taskCompletedTotal: Counter;
  readonly taskFailedTotal: Counter;
  readonly taskDuration: Histogram;
  readonly queueDepth: Gauge;
  readonly queueActive: Gauge;
  readonly providerRequestDuration: Histogram;
  readonly callbackTotal: Counter;
  readonly httpRequestDuration: Histogram;

  // ===== 熔断器和健康指标 =====

  /** 熔断器当前状态 gauge（0=CLOSED, 1=HALF_OPEN, 2=OPEN） */
  readonly circuitBreakerState: Gauge;

  /** 熔断器状态转换计数器 */
  readonly circuitBreakerTransitionsTotal: Counter;

  /** Provider 健康成功率 gauge（0-1） */
  readonly providerHealthSuccessRate: Gauge;

  /** Provider 健康错误率 gauge（0-1） */
  readonly providerHealthErrorRate: Gauge;

  /** Provider 健康平均延迟 gauge（毫秒） */
  readonly providerHealthAvgLatencyMs: Gauge;

  /** 因熔断器触发的故障转移计数器 */
  readonly providerFailoverTotal: Counter;

  /** 路由决策计数器 */
  readonly routingDecisionTotal: Counter;

  constructor() {
    this.taskCreatedTotal = new Counter({
      name: 'modelhub_task_created_total',
      help: 'Total tasks created',
      labelNames: ['feature_type', 'provider', 'model'] as const,
      registers: [this.registry],
    });

    this.taskCompletedTotal = new Counter({
      name: 'modelhub_task_completed_total',
      help: 'Total tasks completed',
      labelNames: ['feature_type', 'provider', 'status'] as const,
      registers: [this.registry],
    });

    this.taskFailedTotal = new Counter({
      name: 'modelhub_task_failed_total',
      help: 'Total tasks failed',
      labelNames: ['feature_type', 'provider', 'error_code'] as const,
      registers: [this.registry],
    });

    this.taskDuration = new Histogram({
      name: 'modelhub_task_duration_ms',
      help: 'Task end-to-end duration in milliseconds',
      labelNames: ['feature_type', 'provider'] as const,
      buckets: [100, 500, 1000, 2000, 5000, 10000, 30000, 60000, 120000, 300000],
      registers: [this.registry],
    });

    this.queueDepth = new Gauge({
      name: 'modelhub_queue_depth',
      help: 'Queue depth (waiting + delayed)',
      labelNames: ['queue', 'feature_type', 'provider'] as const,
      registers: [this.registry],
    });

    this.queueActive = new Gauge({
      name: 'modelhub_queue_active',
      help: 'Active jobs in queue',
      labelNames: ['queue', 'feature_type', 'provider'] as const,
      registers: [this.registry],
    });

    this.providerRequestDuration = new Histogram({
      name: 'modelhub_provider_request_duration_ms',
      help: 'Provider API request duration in milliseconds',
      labelNames: ['provider', 'operation'] as const,
      buckets: [50, 100, 250, 500, 1000, 2500, 5000, 10000],
      registers: [this.registry],
    });

    this.callbackTotal = new Counter({
      name: 'modelhub_callback_total',
      help: 'Total callback attempts',
      labelNames: ['status'] as const,
      registers: [this.registry],
    });

    this.httpRequestDuration = new Histogram({
      name: 'modelhub_http_request_duration_ms',
      help: 'HTTP request duration in milliseconds',
      labelNames: ['method', 'path', 'status_code'] as const,
      buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500],
      registers: [this.registry],
    });

    // ===== 熔断器和健康指标 =====

    this.circuitBreakerState = new Gauge({
      name: 'modelhub_circuit_breaker_state',
      help: '熔断器当前状态（0=CLOSED, 1=HALF_OPEN, 2=OPEN）',
      labelNames: ['provider'] as const,
      registers: [this.registry],
    });

    this.circuitBreakerTransitionsTotal = new Counter({
      name: 'modelhub_circuit_breaker_transitions_total',
      help: '熔断器状态转换总次数',
      labelNames: ['provider', 'from_state', 'to_state'] as const,
      registers: [this.registry],
    });

    this.providerHealthSuccessRate = new Gauge({
      name: 'modelhub_provider_health_success_rate',
      help: 'Provider 健康成功率（0-1）',
      labelNames: ['provider'] as const,
      registers: [this.registry],
    });

    this.providerHealthErrorRate = new Gauge({
      name: 'modelhub_provider_health_error_rate',
      help: 'Provider 健康错误率（0-1）',
      labelNames: ['provider'] as const,
      registers: [this.registry],
    });

    this.providerHealthAvgLatencyMs = new Gauge({
      name: 'modelhub_provider_health_avg_latency_ms',
      help: 'Provider 健康平均延迟（毫秒）',
      labelNames: ['provider'] as const,
      registers: [this.registry],
    });

    this.providerFailoverTotal = new Counter({
      name: 'modelhub_provider_failover_total',
      help: '因熔断器触发的故障转移总次数',
      labelNames: ['provider', 'fallback_provider', 'model'] as const,
      registers: [this.registry],
    });

    this.routingDecisionTotal = new Counter({
      name: 'modelhub_routing_decision_total',
      help: '路由决策计数器',
      labelNames: ['strategy_type', 'provider', 'model'] as const,
      registers: [this.registry],
    });
  }

  onModuleInit() {
    collectDefaultMetrics({ register: this.registry });
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }
}
