import {
  IsString,
  IsOptional,
  Matches,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 用量查询 DTO
 * 日期格式为 YYYYMMDD
 */
export class UsageQueryDto {
  @ApiPropertyOptional({ description: '起始日期（YYYYMMDD）', example: '20260101' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{8}$/, { message: 'from 必须为 YYYYMMDD 格式' })
  from?: string;

  @ApiPropertyOptional({ description: '结束日期（YYYYMMDD）', example: '20260131' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{8}$/, { message: 'to 必须为 YYYYMMDD 格式' })
  to?: string;
}
