import {
  IsInt,
  IsOptional,
  Min,
  Max,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 更新 API 客户端限流配置 DTO
 */
export class UpdateRateLimitsDto {
  @ApiPropertyOptional({ description: '每秒最大请求数', example: 10, minimum: 1, maximum: 1000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  maxQps?: number;

  @ApiPropertyOptional({ description: '最大并发任务数', example: 50, minimum: 1, maximum: 10000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  maxConcurrent?: number;

  @ApiPropertyOptional({ description: '每日最大请求数', example: 10000, minimum: 1, maximum: 10000000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000000)
  maxDailyRequests?: number;
}
