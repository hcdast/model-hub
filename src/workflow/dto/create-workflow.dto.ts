/*
 * 创建工作流 DTO
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsArray,
  IsOptional,
  IsObject,
  ValidateNested,
  IsEnum,
  IsNumber,
  Min,
  Max,
  IsInt,
  IsIn,
  ArrayMaxSize,
  ArrayUnique,
  IsNotEmpty,
  MaxLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

/**
 * 节点位置 DTO
 */
export class NodePositionDto {
  @ApiProperty({ description: 'X 坐标' })
  @IsNumber()
  x!: number;

  @ApiProperty({ description: 'Y 坐标' })
  @IsNumber()
  y!: number;
}

/**
 * 条件规则 DTO
 */
export class ConditionRuleDto {
  @ApiProperty({ description: '条件表达式（JavaScript 表达式）' })
  @IsString()
  @MaxLength(1000)
  expression!: string;

  @ApiProperty({ description: '分支 ID' })
  @IsString()
  @MaxLength(100)
  branchId!: string;
}

/**
 * 循环配置 DTO
 */
export class LoopConfigDto {
  @ApiProperty({ description: '数组来源引用' })
  @IsString()
  @MaxLength(200)
  inputArray!: string;

  @ApiPropertyOptional({ description: '迭代表达式，支持 $item、$index' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  expression?: string;

  @ApiProperty({ description: '输出模式', enum: ['collect', 'last'] })
  @IsEnum(['collect', 'last'])
  outputMode!: 'collect' | 'last';

  @ApiProperty({ description: '并发模式', enum: ['sequential', 'parallel'] })
  @IsEnum(['sequential', 'parallel'])
  parallelism!: 'sequential' | 'parallel';

  @ApiPropertyOptional({ description: '最大并发数' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  maxConcurrency?: number;
}

/**
 * 转换配置 DTO
 */
export class TransformConfigDto {
  @ApiProperty({ description: '转换表达式' })
  @IsString()
  @MaxLength(1000)
  expression!: string;
}

/**
 * 节点数据 DTO
 */
export class NodeDataDto {
  @ApiPropertyOptional({ description: '节点类型（冗余字段，用于前端）' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  type?: string;

  @ApiPropertyOptional({ description: '节点标签' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;

  @ApiPropertyOptional({ description: '模型 ID（type=model 时必填）' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  modelId?: string;

  @ApiPropertyOptional({ description: '参数配置' })
  @IsOptional()
  @IsObject()
  parameters?: Record<string, any>;

  @ApiPropertyOptional({ description: '条件规则（type=condition 时）', type: [ConditionRuleDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ConditionRuleDto)
  conditions?: ConditionRuleDto[];

  @ApiPropertyOptional({ description: '循环配置（type=loop 时）' })
  @IsOptional()
  @ValidateNested()
  @Type(() => LoopConfigDto)
  loopConfig?: LoopConfigDto;

  @ApiPropertyOptional({ description: '转换配置（type=transform 时）' })
  @IsOptional()
  @ValidateNested()
  @Type(() => TransformConfigDto)
  transform?: TransformConfigDto;
}

/**
 * 节点类型枚举
 */
const NODE_TYPES = [
  // 通用节点
  'model', 'condition', 'loop', 'input', 'output', 'transform',
  // 创意与脚本
  'ai-chat', 'script-writer', 'storyboard',
  // 图像生成
  'text-to-image', 'image-to-image', 'image-editor', 'image-upscale',
  // 视频生成
  'text-to-video', 'image-to-video', 'video-to-video', 'video-upscale',
  // 角色与场景
  'character-create', 'face-swap', 'character-swap',
  // 音频处理
  'text-to-speech', 'music-generation',
] as const;

/**
 * 工作流节点 DTO
 */
export class WorkflowNodeDto {
  @ApiProperty({ description: '节点唯一 ID' })
  @IsString()
  @MaxLength(100)
  id!: string;

  @ApiProperty({
    description: '节点类型',
    enum: NODE_TYPES,
  })
  @IsEnum(NODE_TYPES)
  type!: typeof NODE_TYPES[number];

  @ApiProperty({ description: '画布位置', type: NodePositionDto })
  @ValidateNested()
  @Type(() => NodePositionDto)
  position!: NodePositionDto;

  @ApiProperty({ description: '节点数据', type: NodeDataDto })
  @ValidateNested()
  @Type(() => NodeDataDto)
  data!: NodeDataDto;
}

/**
 * 端口引用 DTO
 */
export class PortReferenceDto {
  @ApiProperty({ description: '节点 ID' })
  @IsString()
  @MaxLength(100)
  nodeId!: string;

  @ApiProperty({ description: '端口名称' })
  @IsString()
  @MaxLength(100)
  port!: string;
}

/**
 * 工作流连线 DTO
 */
export class WorkflowEdgeDto {
  @ApiProperty({ description: '连线唯一 ID' })
  @IsString()
  id!: string;

  @ApiProperty({ description: '源节点端口', type: PortReferenceDto })
  @ValidateNested()
  @Type(() => PortReferenceDto)
  source!: PortReferenceDto;

  @ApiProperty({ description: '目标节点端口', type: PortReferenceDto })
  @ValidateNested()
  @Type(() => PortReferenceDto)
  target!: PortReferenceDto;

  @ApiPropertyOptional({ description: '连线标签' })
  @IsOptional()
  @IsString()
  label?: string;

  @ApiPropertyOptional({ description: '条件分支 ID' })
  @IsOptional()
  @IsString()
  branchId?: string;
}

export class ListWorkflowQueryDto {
  @ApiPropertyOptional({ enum: ['draft', 'active', 'archived'] })
  @IsOptional()
  @IsIn(['draft', 'active', 'archived'])
  status?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value) ? value : [value],
  )
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
