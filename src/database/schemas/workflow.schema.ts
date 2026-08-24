import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type WorkflowDocument = HydratedDocument<Workflow>;

/**
 * 工作流节点定义（内嵌文档）
 */
export type WorkflowNodeType =
  | 'model'
  | 'condition'
  | 'loop'
  | 'input'
  | 'output'
  | 'transform'
  | 'ai-chat'
  | 'script-writer'
  | 'storyboard'
  | 'text-to-image'
  | 'image-to-image'
  | 'image-editor'
  | 'image-upscale'
  | 'text-to-video'
  | 'image-to-video'
  | 'video-to-video'
  | 'video-upscale'
  | 'character-create'
  | 'face-swap'
  | 'character-swap'
  | 'text-to-speech'
  | 'music-generation';

export interface WorkflowNode {
  /** 节点唯一 ID */
  id: string;
  /** 节点类型 */
  type: WorkflowNodeType;
  position: { x: number; y: number };
  /** 节点数据 */
  data: {
    label?: string;
    /** type=model 时必填 */
    modelId?: string;
    parameters?: Record<string, any>;
    /** type=condition 时的条件规则 */
    conditions?: ConditionRule[];
    /** type=loop 时的循环配置 */
    loopConfig?: LoopConfig;
    /** type=transform 时的转换配置 */
    transform?: TransformConfig;
  };
}

/**
 * 条件规则定义
 */
export interface ConditionRule {
  /** 条件表达式（JavaScript 表达式） */
  expression: string;
  /** 分支 ID */
  branchId: string;
}

/**
 * 循环配置定义
 */
export interface LoopConfig {
  /** 数组来源引用 */
  inputArray: string;
  /** 输出模式：collect（收集所有结果）或 last（仅最后结果） */
  outputMode: 'collect' | 'last';
  /** 并发模式：sequential（串行）或 parallel（并行） */
  parallelism: 'sequential' | 'parallel';
  /** 最大并发数（parallelism=parallel 时生效） */
  maxConcurrency?: number;
  /** 每次迭代的安全表达式；默认返回当前元素 */
  expression?: string;
}

/**
 * 转换配置定义
 */
export interface TransformConfig {
  /** 转换表达式 */
  expression: string;
}

/**
 * 工作流连线定义（内嵌文档）
 */
export interface WorkflowEdge {
  /** 连线唯一 ID */
  id: string;
  /** 源节点端口 */
  source: { nodeId: string; port: string };
  /** 目标节点端口 */
  target: { nodeId: string; port: string };
  /** 连线标签 */
  label?: string;
  /** 条件分支 ID */
  branchId?: string;
}

/**
 * 画布视口状态
 */
export interface Viewport {
  /** 画布中心 X */
  x: number;
  /** 画布中心 Y */
  y: number;
  /** 缩放级别 */
  zoom: number;
}

/**
 * 工作流输入 Schema 定义
 */
export interface InputSchemaField {
  type: string;
  required: boolean;
  default?: any;
}

/**
 * 执行配置
 */
export interface ExecutionConfig {
  /** 整体超时（秒） */
  timeout?: number;
  /** 失败策略 */
  failureStrategy?: 'fail-fast' | 'continue';
  /** 最大并行节点数 */
  maxParallelism?: number;
}

/**
 * 工作流 Schema —— collection: workflows。
 * 存储工作流定义，包含节点、连线、布局数据。
 */
@Schema({ timestamps: true, collection: 'workflows' })
export class Workflow {
  /** 工作流名称 */
  @Prop({ required: true })
  name!: string;

  /** 工作流描述 */
  @Prop()
  description?: string;

  /** 创建者 ID（API Client ID 或用户 ID） */
  @Prop({ required: true })
  creatorId!: string;

  /** 工作流状态 */
  @Prop({
    default: 'draft',
    enum: ['draft', 'active', 'archived'],
  })
  status!: string;

  /** 标签列表 */
  @Prop({ type: [String], default: [] })
  tags!: string[];

  /** 节点定义 */
  @Prop({ type: [MongooseSchema.Types.Mixed], required: true })
  nodes!: WorkflowNode[];

  /** 连线定义 */
  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  edges!: WorkflowEdge[];

  /** 画布视口状态（供前端恢复画布） */
  @Prop({ type: Object })
  viewport?: Viewport;

  /** 工作流输入定义 */
  @Prop({ type: Object })
  inputSchema?: Record<string, InputSchemaField>;

  /** 工作流输出定义（输出名 -> 节点输出引用） */
  @Prop({ type: Object })
  outputMapping?: Record<string, string>;

  /** 执行配置 */
  @Prop({ type: Object, default: {} })
  executionConfig!: ExecutionConfig;
}

export const WorkflowSchema = SchemaFactory.createForClass(Workflow);

/** 按创建者和创建时间查询 */
WorkflowSchema.index({ creatorId: 1, createdAt: -1 });

/** 按状态查询 */
WorkflowSchema.index({ status: 1 });
