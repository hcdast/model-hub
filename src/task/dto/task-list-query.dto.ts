import { IsOptional, IsString, IsNumber, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class TaskListQueryDto {
  @ApiPropertyOptional({ description: '任务状态', enum: ['PENDING', 'SUBMITTED', 'PROCESSING', 'SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED'] })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiPropertyOptional({ description: '模型标识', example: 'wavespeed-ai/flux-2-pro/text-to-image' })
  @IsString()
  @IsOptional()
  model?: string;

  @ApiPropertyOptional({ description: '厂商', example: 'wavespeed-ai' })
  @IsString()
  @IsOptional()
  provider?: string;

  @ApiPropertyOptional({ description: '功能类型', enum: ['image_generate', 'image_to_video', 'character_swap', 'video_upscale'] })
  @IsString()
  @IsOptional()
  featureType?: string;

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
