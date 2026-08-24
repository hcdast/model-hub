/*
 * 创建工作流 DTO（完整）
 */
import {
  ApiProperty,
  ApiPropertyOptional,
  PartialType,
} from '@nestjs/swagger';
import {
  IsString,
  IsArray,
  IsOptional,
  IsObject,
  ValidateNested,
  IsBoolean,
  IsNumber,
  IsInt,
  IsIn,
  Min,
  Max,
  MaxLength,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  WorkflowNodeDto,
  WorkflowEdgeDto,
} from './create-workflow.dto';

/**
 * 视口 DTO
 */
export class ViewportDto {
  @ApiProperty({ description: '画布中心 X' })
  @Type(() => Number)
  @IsNumber()
  x!: number;

  @ApiProperty({ description: '画布中心 Y' })
  @Type(() => Number)
  @IsNumber()
  y!: number;

  @ApiProperty({ description: '缩放级别' })
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(10)
  zoom!: number;
}

/**
 * 输入 Schema 字段 DTO
 */
export class InputSchemaFieldDto {
  @ApiProperty({ description: '数据类型' })
  @IsString()
  type!: string;

  @ApiProperty({ description: '是否必需' })
  @IsBoolean()
  required!: boolean;

  @ApiPropertyOptional({ description: '默认值' })
  @IsOptional()
  default?: any;
}

/**
 * 执行配置 DTO
 */
export class ExecutionConfigDto {
  @ApiPropertyOptional({ description: '整体超时（秒）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3600)
  timeout?: number;

  @ApiPropertyOptional({ description: '失败策略', enum: ['fail-fast', 'continue'] })
  @IsOptional()
  @IsIn(['fail-fast', 'continue'])
  failureStrategy?: 'fail-fast' | 'continue';

  @ApiPropertyOptional({ description: '最大并行节点数' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  maxParallelism?: number;
}

/**
 * 创建工作流 DTO
 */
export class CreateWorkflowDto {
  @ApiPropertyOptional({ description: '工作流名称' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ description: '工作流描述' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ description: '节点定义', type: [WorkflowNodeDto] })
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => WorkflowNodeDto)
  nodes!: WorkflowNodeDto[];

  @ApiPropertyOptional({ description: '连线定义', type: [WorkflowEdgeDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => WorkflowEdgeDto)
  edges?: WorkflowEdgeDto[];

  @ApiPropertyOptional({ description: '画布视口状态', type: ViewportDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ViewportDto)
  viewport?: ViewportDto;

  @ApiPropertyOptional({ description: '工作流输入定义' })
  @IsOptional()
  @IsObject()
  inputSchema?: Record<string, any>;

  @ApiPropertyOptional({ description: '工作流输出定义' })
  @IsOptional()
  @IsObject()
  outputMapping?: Record<string, string>;

  @ApiPropertyOptional({ description: '执行配置', type: ExecutionConfigDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ExecutionConfigDto)
  executionConfig?: ExecutionConfigDto;

  @ApiPropertyOptional({ description: '标签列表' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @MaxLength(100, { each: true })
  @IsString({ each: true })
  tags?: string[];
}

export class UpdateWorkflowDto extends PartialType(CreateWorkflowDto) {}
