import { IsOptional, IsString, IsNumber, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 交易记录查询参数 DTO
 *
 * 用于管理后台查询指定 API Client 的钱包交易记录，支持按类型筛选和分页。
 */
export class TransactionQueryDto {
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

  @ApiPropertyOptional({ description: '交易类型筛选', enum: ['credit', 'debit', 'freeze', 'unfreeze'] })
  @IsString()
  @IsOptional()
  type?: string;
}
