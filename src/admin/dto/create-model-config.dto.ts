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
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 创建模型配置 DTO
 */
export class CreateModelConfigDto {
  @ApiProperty({ description: '模型名称', example: 'example-model' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  model_name!: string;

  @ApiProperty({ description: '模型类型', example: 40001 })
  @IsNumber()
  @IsNotEmpty()
  @Min(40000)
  model_type!: number;

  @ApiProperty({ description: '提供商', example: 'Example Provider' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  provider!: string;

  @ApiProperty({ description: '显示标签', example: 'Example Model' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  label!: string;

  @ApiProperty({ description: '服务标识', example: 'example' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  service!: string;

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

  @ApiPropertyOptional({ description: '分组', example: 'image-generation' })
  @IsString()
  @IsOptional()
  group?: string;

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
