import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { RedisModule } from '../redis/redis.module';
import { ObservabilityModule } from '../observability/observability.module';
import { ProviderModule } from '../provider/provider.module';
import { CircuitBreakerStore } from './circuit-breaker-store.service';
import { CircuitBreakerConfigService } from './circuit-breaker-config.service';
import { HealthMetricsCollector } from './health-metrics-collector.service';
import { CircuitBreakerService } from './circuit-breaker.service';

/**
 * Provider 健康监控模块
 * 负责健康指标采集、熔断器状态管理和配置管理
 * 在 api、worker、scheduler 进程中加载
 */
@Module({
  imports: [DatabaseModule, RedisModule, ObservabilityModule, ProviderModule],
  providers: [CircuitBreakerStore, CircuitBreakerConfigService, HealthMetricsCollector, CircuitBreakerService],
  exports: [CircuitBreakerStore, CircuitBreakerConfigService, HealthMetricsCollector, CircuitBreakerService],
})
export class ProviderHealthModule {}
