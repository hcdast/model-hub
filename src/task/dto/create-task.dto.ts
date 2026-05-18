import { Expose, Transform } from 'class-transformer';
import {
  IsString, IsNotEmpty, IsObject, IsOptional, IsUrl, IsNumber, Min, Max, MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTaskDto {
  @ApiProperty({
    description: '模型标识（与 model_id 二选一；由 model_id 或 model 归一化得到）',
    example: 'kling-v3.0-pro/text-to-video',
  })
  @Expose()
  @Transform(({ obj }) => {
    const raw = obj.model_id ?? obj.model;
    if (raw == null) return raw;
    return String(raw).trim();
  })
  @IsString()
  @IsNotEmpty({ message: 'model_id 或 model 至少提供一个' })
  @MaxLength(200)
  model!: string;

  @ApiPropertyOptional({
    description: '模型标识（对外短名，与 model_configs.model_id 一致；推荐）',
    example: 'kling-v3.0-pro/text-to-video',
  })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  model_id?: string;

  @ApiProperty({ description: '模型输入参数', example: { prompt: 'A sunset over mountains', width: 1024, height: 1024 } })
  @IsObject()
  @IsNotEmpty()
  input!: Record<string, any>;

  @ApiPropertyOptional({ description: '模型可选参数' })
  @IsObject()
  @IsOptional()
  options?: Record<string, any>;

  @ApiPropertyOptional({ description: '回调地址', example: 'https://your-server.com/webhooks/model-hub' })
  @IsUrl({ require_tld: false })
  @IsOptional()
  callbackUrl?: string;

  @ApiPropertyOptional({ description: '回调签名密钥' })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  callbackSecret?: string;

  @ApiPropertyOptional({ description: '优先级 (0=最高, 100=最低)', default: 50, minimum: 0, maximum: 100 })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  priority?: number;

  @ApiPropertyOptional({ description: '业务扩展字段', example: { userId: 'user_123' } })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;
}
