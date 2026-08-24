import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { UpdateRateLimitsDto } from './update-rate-limits.dto';

export class CreateApiClientDto {
  @ApiPropertyOptional({ description: '显示名称', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ enum: ['internal', 'external', 'exempt'] })
  @IsOptional()
  @IsIn(['internal', 'external', 'exempt'])
  billingPolicy?: 'internal' | 'external' | 'exempt';

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  defaultPriority?: number;

  @ApiPropertyOptional({ type: UpdateRateLimitsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateRateLimitsDto)
  rateLimits?: UpdateRateLimitsDto;

  @ApiPropertyOptional({ type: [String], maxItems: 100 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  modelAllowlist?: string[];
}
