import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsBoolean,
  IsObject,
  IsArray,
  IsOptional,
  MaxLength,
  Min,
  IsIn,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MODEL_CONFIG_MODEL_TYPES } from '../../common/constants/model-config-model-type';

/**
 * 创建模型配置 DTO
 */
export class CreateModelConfigDto {
  @ApiProperty({
    description: '模型标识，与创建任务请求体 model 一致',
    example: 'wavespeed-ai/flux-2-pro/text-to-image',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  model_id!: string;

  @ApiProperty({
    description: '能力类型（camelCase），与创建任务 options.featureType 一致',
    example: 'textToImage',
    enum: MODEL_CONFIG_MODEL_TYPES,
  })
  @IsString()
  @IsNotEmpty()
  @IsIn([...MODEL_CONFIG_MODEL_TYPES])
  model_type!: string;

  @ApiProperty({ description: 'Adapter 注册名（ProviderRegistry）', example: 'wavespeed-ai' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  provider!: string;

  @ApiProperty({ description: '展示名称', example: 'Flux 2 Pro 文生图' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  model_name!: string;

  @ApiProperty({
    description:
      '单位价格映射（必填）。必须含 default 档对象：cost_unit_price（>=0）、sale_unit_price（>0）、unit_credit（>0）；可按分辨率等扩展档位键。',
    example: {
      default: {
        cost_unit_price: 0,
        sale_unit_price: 0.01,
        unit_credit: 1,
        original_unit_credit: 1,
      },
    },
  })
  @IsObject()
  @IsNotEmpty()
  unit_price_map!: Record<string, any>;

  @ApiPropertyOptional({ description: '提供商模型名称', example: 'provider/model-name' })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  provider_model_name?: string;

  @ApiPropertyOptional({ description: '描述', example: '这是一个示例模型' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ description: '标签', example: ['tag1', 'tag2'] })
  @IsArray()
  @IsOptional()
  tags?: any[];

  @ApiPropertyOptional({ description: '排序值', example: 100 })
  @IsNumber()
  @IsOptional()
  @Min(0)
  sort?: number;

  @ApiPropertyOptional({ description: '是否禁用', example: false })
  @IsBoolean()
  @IsOptional()
  disabled?: boolean;

  @ApiPropertyOptional({ description: '参数配置', example: {} })
  @IsObject()
  @IsOptional()
  params?: Record<string, any>;
}
