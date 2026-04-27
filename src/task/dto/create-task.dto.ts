import {
  IsString, IsNotEmpty, IsObject, IsOptional, IsUrl, IsNumber, Min, Max, MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTaskDto {
  @ApiProperty({ description: '模型标识', example: 'wavespeed-ai/flux-2-pro/text-to-image' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  model!: string;

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
