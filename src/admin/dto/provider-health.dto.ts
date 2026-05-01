import {
  IsEnum,
  IsOptional,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CircuitState } from '../../provider-health/interfaces/circuit-breaker-state.interface';

/**
 * Provider 健康概览 DTO
 */
export class ProviderHealthOverviewDto {
  @ApiProperty({ description: 'Provider 名称' })
  provider!: string;

  @ApiProperty({ description: '熔断器状态', enum: CircuitState })
  circuitState!: CircuitState;

  @ApiProperty({ description: '成功率（0-1）' })
  successRate!: number;

  @ApiProperty({ description: '平均延迟（毫秒）' })
  avgLatencyMs!: number;

  @ApiProperty({ description: '错误率（0-1）' })
  errorRate!: number;

  @ApiProperty({ description: '滑动窗口样本数' })
  sampleCount!: number;

  @ApiProperty({ description: '最后状态转换时间（ISO 8601）' })
  lastTransitionAt!: string;

  @ApiProperty({ description: '是否有手动覆盖' })
  hasManualOverride!: boolean;
}

/**
 * 熔断器手动覆盖请求 DTO
 */
export class CircuitBreakerOverrideDto {
  @ApiProperty({
    description: '目标熔断状态（仅允许 OPEN 或 CLOSED）',
    enum: [CircuitState.OPEN, CircuitState.CLOSED],
  })
  @IsEnum([CircuitState.OPEN, CircuitState.CLOSED], {
    message: '仅允许设置为 OPEN 或 CLOSED',
  })
  state!: CircuitState;
}

/**
 * 更新熔断器配置请求 DTO
 */
export class UpdateCircuitBreakerConfigDto {
  @ApiPropertyOptional({ description: '错误率阈值（1-100）', minimum: 1, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  error_rate_threshold?: number;

  @ApiPropertyOptional({ description: '连续失败次数阈值', minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  consecutive_failure_threshold?: number;

  @ApiPropertyOptional({ description: '冷却时间（毫秒，5000-300000）', minimum: 5000, maximum: 300000 })
  @IsOptional()
  @IsInt()
  @Min(5000)
  @Max(300000)
  cooldown_duration_ms?: number;

  @ApiPropertyOptional({ description: '探针请求数量', minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  probe_request_count?: number;

  @ApiPropertyOptional({ description: '滑动窗口时长（毫秒）', minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  sliding_window_duration_ms?: number;

  @ApiPropertyOptional({ description: '最小样本数', minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  min_sample_count?: number;
}
