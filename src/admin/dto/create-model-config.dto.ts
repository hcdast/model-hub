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
  // ===== 必填字段 =====
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

  // ===== 可选字段 =====
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

  @ApiPropertyOptional({ description: '是否不可用', example: false })
  @IsBoolean()
  @IsOptional()
  unusable?: boolean;

  @ApiPropertyOptional({ description: '是否显示', example: true })
  @IsBoolean()
  @IsOptional()
  display?: boolean;

  @ApiPropertyOptional({ description: '单位积分映射', example: { default: 1 } })
  @IsObject()
  @IsOptional()
  unit_credit_map?: Record<string, any>;

  @ApiPropertyOptional({
    description: '单位价格映射',
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
  @IsOptional()
  unit_price_map?: Record<string, any>;

  @ApiPropertyOptional({ description: '时长步长', example: 1 })
  @IsNumber()
  @IsOptional()
  @Min(1)
  duration_step?: number;

  @ApiPropertyOptional({ description: '音频额外积分倍数', example: 1 })
  @IsNumber()
  @IsOptional()
  @Min(1)
  audio_extra_credit_multiplier?: number;

  @ApiPropertyOptional({ description: '折扣配置', example: {} })
  @IsObject()
  @IsOptional()
  discount?: Record<string, any>;

  @ApiPropertyOptional({ description: '是否需要付费', example: false })
  @IsBoolean()
  @IsOptional()
  requires_pay?: boolean;

  @ApiPropertyOptional({ description: '所需优先级', example: 10 })
  @IsNumber()
  @IsOptional()
  @Min(0)
  requires_priority?: number;

  @ApiPropertyOptional({ description: '无限模式所需优先级', example: -1 })
  @IsNumber()
  @IsOptional()
  requires_priority_4_unlimit_mode?: number;

  @ApiPropertyOptional({ description: '月度无限模式所需优先级' })
  @IsNumber()
  @IsOptional()
  requires_priority_4_unlimit_mode_monthly?: number;

  @ApiPropertyOptional({ description: '年度无限模式所需优先级' })
  @IsNumber()
  @IsOptional()
  requires_priority_4_unlimit_mode_yearly?: number;

  @ApiPropertyOptional({ description: '是否支持无限模式', example: false })
  @IsBoolean()
  @IsOptional()
  supported_unlimit_mode?: boolean;

  @ApiPropertyOptional({ description: '无限模式开始时间', example: 0 })
  @IsNumber()
  @IsOptional()
  @Min(0)
  supported_unlimit_mode_start_time?: number;

  @ApiPropertyOptional({ description: '月度无限天数配置' })
  @IsObject()
  @IsOptional()
  supported_unlimit_days_monthly?: Record<string, any>;

  @ApiPropertyOptional({ description: '年度无限天数配置' })
  @IsObject()
  @IsOptional()
  supported_unlimit_days_yearly?: Record<string, any>;

  @ApiPropertyOptional({ description: '是否支持最后一帧', example: false })
  @IsBoolean()
  @IsOptional()
  supported_last_frame?: boolean;

  @ApiPropertyOptional({ description: '是否支持第一帧', example: false })
  @IsBoolean()
  @IsOptional()
  supported_first_frame?: boolean;

  @ApiPropertyOptional({ description: '是否支持扩展提示词', example: false })
  @IsBoolean()
  @IsOptional()
  supported_extend_prompt?: boolean;

  @ApiPropertyOptional({ description: '是否支持参考图', example: false })
  @IsBoolean()
  @IsOptional()
  supported_reference?: boolean;

  @ApiPropertyOptional({ description: '是否支持变体', example: false })
  @IsBoolean()
  @IsOptional()
  supported_variation?: boolean;

  @ApiPropertyOptional({ description: '是否支持保留原声', example: false })
  @IsBoolean()
  @IsOptional()
  supported_keep_original_sound?: boolean;

  @ApiPropertyOptional({ description: '是否支持网络搜索', example: false })
  @IsBoolean()
  @IsOptional()
  supported_web_search?: boolean;

  @ApiPropertyOptional({ description: '是否为 Akool TP', example: false })
  @IsBoolean()
  @IsOptional()
  is_akool_tp?: boolean;

  @ApiPropertyOptional({ description: '是否为扩展模型', example: false })
  @IsBoolean()
  @IsOptional()
  is_extend_model?: boolean;

  @ApiPropertyOptional({ description: '是否为 SD2', example: false })
  @IsBoolean()
  @IsOptional()
  is_sd2?: boolean;

  @ApiPropertyOptional({ description: '是否支持元素', example: false })
  @IsBoolean()
  @IsOptional()
  supports_elements?: boolean;

  @ApiPropertyOptional({ description: '是否支持参考', example: false })
  @IsBoolean()
  @IsOptional()
  supports_reference?: boolean;

  @ApiPropertyOptional({ description: '是否支持内联媒体', example: false })
  @IsBoolean()
  @IsOptional()
  supports_inline_media?: boolean;

  @ApiPropertyOptional({ description: '是否支持一体化参考', example: false })
  @IsBoolean()
  @IsOptional()
  support_all_in_one_reference?: boolean;

  @ApiPropertyOptional({ description: '最大数量', example: 4 })
  @IsNumber()
  @IsOptional()
  @Min(1)
  max_count?: number;

  @ApiPropertyOptional({ description: '批量数量选项', example: [1] })
  @IsArray()
  @IsOptional()
  batch_quantity?: number[];

  @ApiPropertyOptional({ description: '最大资源数量' })
  @IsNumber()
  @IsOptional()
  @Min(1)
  max_resource_count?: number;

  @ApiPropertyOptional({ description: '锁定时长限制' })
  @IsObject()
  @IsOptional()
  lock_duration_limit?: Record<string, any>;

  @ApiPropertyOptional({ description: '参数配置', example: {} })
  @IsObject()
  @IsOptional()
  params?: Record<string, any>;
}
