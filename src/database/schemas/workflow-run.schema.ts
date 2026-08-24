import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type WorkflowRunDocument = HydratedDocument<WorkflowRun>;

/**
 * 节点执行状态（内嵌文档）
 */
export interface NodeExecutionState {
  /** 节点唯一 ID */
  nodeId: string;
  /** 节点执行状态 */
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'cancelled';
  /** Bull Job ID */
  jobId?: string;
  /** 子任务 ID */
  taskId?: string;
  /** 节点输入 */
  input?: Record<string, any>;
  /** 节点输出 */
  output?: Record<string, any>;
  /** 错误信息 */
  error?: { code: string; message: string };
  /** 开始时间 */
  startedAt?: Date;
  /** 完成时间 */
  completedAt?: Date;
  /** 重试次数 */
  retryCount: number;
  /** 当前执行尝试，从 0 开始 */
  attempt?: number;
}

/**
 * 工作流执行统计
 */
export interface WorkflowRunStats {
  /** 总节点数 */
  totalNodes: number;
  /** 已完成节点数 */
  completedNodes: number;
  /** 失败节点数 */
  failedNodes: number;
  /** 跳过节点数 */
  skippedNodes: number;
  /** 总耗时（毫秒） */
  totalDuration: number;
  /** 预估成本 */
  estimatedCost: number;
}

/**
 * 工作流错误信息
 */
export interface WorkflowRunError {
  /** 错误码 */
  code: string;
  /** 错误消息 */
  message: string;
  /** 出错节点 ID */
  nodeId?: string;
}

/**
 * 工作流执行实例 Schema —— collection: workflow_runs。
 * 记录工作流执行状态、各节点执行结果、错误信息。
 */
@Schema({ timestamps: true, collection: 'workflow_runs' })
export class WorkflowRun {
  /** 执行实例唯一 ID */
  @Prop({ required: true })
  runId!: string;

  /** 关联的工作流 ID */
  @Prop({ required: true })
  workflowId!: string;

  /** 执行时的工作流版本快照 */
  @Prop({ required: true })
  workflowVersion!: number;

  /** 触发者 ID（clientId 或 userId） */
  @Prop({ required: true })
  triggerId!: string;

  /** 关联的父任务 ID */
  @Prop({ required: true })
  parentTaskId!: string;

  /** 用于任务、计费和钱包归属的非敏感客户端标识 */
  @Prop()
  executionApiKey?: string;
  @Prop({ default: 300 })
  executionTimeoutSeconds!: number;

  /** 执行状态 */
  @Prop({
    default: 'pending',
    enum: ['pending', 'running', 'succeeded', 'failed', 'cancelled'],
  })
  status!: string;

  /** 开始时间 */
  @Prop()
  startedAt?: Date;

  /** 完成时间 */
  @Prop()
  completedAt?: Date;

  /** 工作流输入 */
  @Prop({ type: Object })
  input?: Record<string, any>;

  /** 工作流输出 */
  @Prop({ type: Object })
  output?: Record<string, any>;

  /** 节点执行状态列表 */
  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  nodeStates!: NodeExecutionState[];

  /** 错误信息 */
  @Prop({ type: MongooseSchema.Types.Mixed })
  error?: WorkflowRunError;

  /** 执行统计 */
  @Prop({ type: Object })
  stats?: WorkflowRunStats;
}

export const WorkflowRunSchema = SchemaFactory.createForClass(WorkflowRun);

/** 按工作流 ID 和创建时间查询 */
WorkflowRunSchema.index({ workflowId: 1, createdAt: -1 });

/** runId 唯一索引 */
WorkflowRunSchema.index({ runId: 1 }, { unique: true });
WorkflowRunSchema.index({ triggerId: 1, createdAt: -1 });

/** 按父任务 ID 查询 */
WorkflowRunSchema.index({ parentTaskId: 1 });
