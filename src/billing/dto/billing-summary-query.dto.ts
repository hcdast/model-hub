import { IsOptional, IsString, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 计费汇总查询参数 DTO
 *
 * 用于管理后台按维度聚合计费数据，支持按模型、客户端、日期分组。
 */
export class BillingSummaryQueryDto {
  @ApiPropertyOptional({ description: '分组维度', enum: ['model', 'apiKey', 'date'], default: 'model' })
  @IsString()
  @IsOptional()
  @IsIn(['model', 'apiKey', 'date'])
  groupBy?: 'model' | 'apiKey' | 'date';

  @ApiPropertyOptional({ description: '计费策略筛选', enum: ['internal', 'external'] })
  @IsString()
  @IsOptional()
  billingPolicy?: string;

  @ApiPropertyOptional({ description: '开始日期（ISO 格式）', example: '2025-01-01T00:00:00Z' })
  @IsString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ description: '结束日期（ISO 格式）', example: '2025-12-31T23:59:59Z' })
  @IsString()
  @IsOptional()
  endDate?: string;
}
