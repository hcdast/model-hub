import { IsOptional, IsString, IsNumber, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 计费记录查询参数 DTO
 *
 * 用于管理后台查询 BillingRecord 列表，支持多维度筛选和分页。
 */
export class BillingQueryDto {
  @ApiPropertyOptional({ description: 'API Client ID 筛选', example: 'client_abc123' })
  @IsString()
  @IsOptional()
  clientId?: string;

  @ApiPropertyOptional({ description: '模型名称筛选', example: 'wavespeed-ai/flux-2-pro/text-to-image' })
  @IsString()
  @IsOptional()
  model?: string;

  @ApiPropertyOptional({ description: '计费策略筛选', enum: ['internal', 'external'] })
  @IsString()
  @IsOptional()
  billingPolicy?: string;

  @ApiPropertyOptional({ description: '计费状态筛选', enum: ['estimated', 'pre_deducted', 'settled', 'refunded', 'failed'] })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiPropertyOptional({ description: '开始日期（ISO 格式）', example: '2025-01-01T00:00:00Z' })
  @IsString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ description: '结束日期（ISO 格式）', example: '2025-12-31T23:59:59Z' })
  @IsString()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional({ description: '页码', default: 1, minimum: 1 })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: '每页数量', default: 20, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}
