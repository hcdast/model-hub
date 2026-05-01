import {
  IsArray,
  IsString,
  ArrayMaxSize,
  MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * 更新 API 客户端模型白名单 DTO
 */
export class UpdateModelAllowlistDto {
  @ApiProperty({
    description: '模型白名单，支持通配符模式（如 wavespeed-ai/*）；空数组表示允许所有模型',
    example: ['wavespeed-ai/*', 'openai/gpt-4'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  @ArrayMaxSize(100)
  modelAllowlist!: string[];
}
