import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import {
  Workflow,
  WorkflowNode,
  WorkflowEdge,
  Viewport,
  InputSchemaField,
  ExecutionConfig,
} from './workflow.schema';

export type WorkflowTemplateDocument = HydratedDocument<WorkflowTemplate>;

/**
 * 工作流模板 Schema —— collection: workflow_templates。
 * 存储可复用的工作流模板，供开发者门户展示预置模板。
 */
@Schema({ timestamps: true, collection: 'workflow_templates' })
export class WorkflowTemplate {
  /** 模板名称 */
  @Prop({ required: true })
  name!: string;

  /** 模板描述 */
  @Prop()
  description?: string;

  /** 模板分类 */
  @Prop({ required: true })
  category!: string;

  /** 标签列表 */
  @Prop({ type: [String], default: [] })
  tags!: string[];

  /** 缩略图 URL */
  @Prop()
  thumbnail?: string;

  /** 完整工作流定义 */
  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  workflowDefinition!: WorkflowDefinition;

  /** 是否公开 */
  @Prop({ default: false })
  isPublic!: boolean;

  /** 创建者 ID */
  @Prop()
  creatorId?: string;

  /** 模板版本号 */
  @Prop({ default: 1 })
  version!: number;
}

/**
 * 工作流定义（内嵌文档）
 * 用于模板中的完整工作流快照
 */
export interface WorkflowDefinition {
  /** 工作流名称 */
  name: string;
  /** 工作流描述 */
  description?: string;
  /** 节点定义 */
  nodes: WorkflowNode[];
  /** 连线定义 */
  edges: WorkflowEdge[];
  /** 画布视口状态 */
  viewport?: Viewport;
  /** 工作流输入定义 */
  inputSchema?: Record<string, InputSchemaField>;
  /** 工作流输出定义 */
  outputMapping?: Record<string, string>;
  /** 执行配置 */
  executionConfig?: ExecutionConfig;
}

export const WorkflowTemplateSchema = SchemaFactory.createForClass(WorkflowTemplate);

/** 按分类和公开状态查询 */
WorkflowTemplateSchema.index({ category: 1, isPublic: 1 });
