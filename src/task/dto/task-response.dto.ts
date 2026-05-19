import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** 任务错误信息 */
export class TaskErrorDto {
  @ApiPropertyOptional({ example: 'PROVIDER_FAILED' })
  code?: string;

  @ApiPropertyOptional({ example: 'Provider task failed' })
  message?: string;

  @ApiPropertyOptional({ example: false })
  retryable?: boolean;
}

/** 任务计费摘要（查询详情时可能附带） */
export class TaskBillingSummaryDto {
  @ApiPropertyOptional({ example: 'settled' })
  status?: string;

  @ApiPropertyOptional({ example: 'external' })
  billingPolicy?: string;

  @ApiPropertyOptional({ example: 'duration' })
  usageType?: string;

  @ApiPropertyOptional()
  estimatedUsage?: number;

  @ApiPropertyOptional()
  estimatedCost?: number;

  @ApiPropertyOptional()
  actualUsage?: number;

  @ApiPropertyOptional()
  actualCost?: number;

  @ApiPropertyOptional()
  unitPrice?: number;

  @ApiPropertyOptional({ example: 'USD' })
  currency?: string;

  @ApiPropertyOptional()
  settledAt?: string;
}

/**
 * 任务查询/列表中的 data 主体。
 * `result` 在成功时：媒体类输出统一为 URL 字符串数组；少数同步任务可能为结构化对象。
 */
export class TaskResponseDto {
  @ApiProperty({ example: '01KRWGH6ZZDSZDXTDDTY9YXMMN' })
  taskId!: string;

  @ApiProperty({ example: 'mh_01KPBE1Z3WCDX5RY5H66YY4E86' })
  apiKey!: string;

  @ApiProperty({
    enum: ['PENDING', 'SUBMITTED', 'PROCESSING', 'SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED'],
    example: 'SUCCESS',
  })
  status!: string;

  @ApiProperty({ example: 'kling-v3.0-pro/characterswap' })
  model!: string;

  @ApiProperty({ example: 'wavespeed-ai' })
  provider!: string;

  @ApiPropertyOptional({ example: 'kwaivgi/kling-v3.0-pro/motion-control' })
  providerModel?: string;

  @ApiPropertyOptional({ example: 'character_swap' })
  featureType?: string;

  @ApiPropertyOptional({ example: '6a0a77a8a7a72a4f4d7ef838' })
  routeId?: string;

  @ApiPropertyOptional({ example: 'routing_rule', enum: ['routing_rule', 'model_config', 'path_fallback'] })
  routingSource?: string;

  @ApiPropertyOptional({
    description:
      '任务成功时的输出。媒体类结果（图/视频/音频 URL）统一为字符串数组；'
      + '少数同步任务可能为结构化对象（如含 output、usage 字段）。',
    isArray: true,
    type: String,
    example: ['https://cdn.example.com/output.mp4'],
  })
  result?: string[] | Record<string, unknown>;

  @ApiPropertyOptional({ type: TaskErrorDto })
  error?: TaskErrorDto;

  @ApiPropertyOptional({ type: TaskBillingSummaryDto })
  billing?: TaskBillingSummaryDto;

  @ApiProperty({ example: '2026-05-18T03:02:06.315Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-05-18T03:13:07.213Z' })
  updatedAt!: string;
}

export class TaskListDataDto {
  @ApiProperty({ type: [TaskResponseDto] })
  items!: TaskResponseDto[];

  @ApiProperty({ example: 156 })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  pageSize!: number;
}

export class TaskApiResponseDto {
  @ApiProperty({ example: 0 })
  code!: number;

  @ApiProperty({ example: 'Success' })
  message!: string;

  @ApiProperty({ type: TaskResponseDto })
  data!: TaskResponseDto;
}

export class TaskListApiResponseDto {
  @ApiProperty({ example: 0 })
  code!: number;

  @ApiProperty({ example: 'Success' })
  message!: string;

  @ApiProperty({ type: TaskListDataDto })
  data!: TaskListDataDto;
}

/** 业务回调 POST body（/v1/tasks 创建时配置的 callbackUrl） */
export class TaskCallbackPayloadDto {
  @ApiProperty({ example: '01KRWGH6ZZDSZDXTDDTY9YXMMN' })
  taskId!: string;

  @ApiProperty({ example: 'SUCCESS' })
  status!: string;

  @ApiPropertyOptional({
    description: '与查询任务接口的 result 字段一致：媒体类为 URL 字符串数组。',
    isArray: true,
    type: String,
    example: ['https://cdn.example.com/output.mp4'],
    nullable: true,
  })
  result!: string[] | Record<string, unknown> | null;

  @ApiPropertyOptional({ type: TaskErrorDto, nullable: true })
  error!: TaskErrorDto | null;

  @ApiProperty({ example: '2026-05-18T03:13:07.213Z' })
  completedAt!: string;
}
