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

  @ApiPropertyOptional({
    description:
      '单位价格映射；支持 default 与分辨率等档位键（与请求 input.resolution / input.size 一致）。每档可为对象：cost_unit_price（$/用量单位）、sale_unit_price（$/credit）、unit_credit 等。',
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

  @ApiPropertyOptional({
    description:
      '厂商成本 USD 单价兜底（$/用量单位）。优先使用 unit_price_map 命中档位内的 cost_unit_price；档位来自任务 input.resolution/size，无则 default。',
    example: 0.05,
  })
  @IsNumber()
  @IsOptional()
  @Min(0)
  cost_unit_price?: number;

  @ApiPropertyOptional({
    description:
      '对客户 credit 的 USD 单价兜底（$/credit）。优先使用 unit_price_map 命中档位内的 sale_unit_price；档位规则同上。',
    example: 0.002,
  })
  @IsNumber()
  @IsOptional()
  @Min(0)
  sale_unit_price?: number;

  @ApiPropertyOptional({ description: '音频额外积分倍数', example: 1 })
  @IsNumber()
  @IsOptional()
  @Min(1)
  audio_extra_credit_multiplier?: number;

  @ApiPropertyOptional({ description: '折扣配置', example: {} })
  @IsObject()
  @IsOptional()
  discount?: Record<string, any>;

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

  @ApiPropertyOptional({ description: '是否为扩展模型', example: false })
  @IsBoolean()
  @IsOptional()
  is_extend_model?: boolean;

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

  @ApiPropertyOptional({
    description:
      '出图数量与对应优先级档位（与 AGI outputQuantityConfig 一致），如 [{ value: 1, level: 10 }, ...]',
    example: [{ value: 1, level: 10 }],
  })
  @IsArray()
  @IsOptional()
  output_quantity_config?: any[];

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
