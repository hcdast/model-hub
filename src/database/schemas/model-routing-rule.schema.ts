import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type ModelRoutingRuleDocument = HydratedDocument<ModelRoutingRule>;

/**
 * 按模型（及可选 client）解析服务商的路由规则。
 * - fixed：固定 provider
 * - weighted：按 weighted_targets 权重比例分流（同 client+模型+规则下稳定）
 * - primary_fallback：主备 + 可选 primary_weight / fallback_weight 比例分流
 * - latency：基于实时延迟选择最快的 provider
 * - cost：基于单价选择最便宜的 provider
 */
@Schema({ timestamps: true, collection: 'model_routing_rules' })
export class ModelRoutingRule {
  @Prop({ required: true, index: true })
  model_name!: string;

  /** 空字符串表示匹配任意 client */
  @Prop({ default: '' })
  client_id!: string;

  @Prop({ default: true, index: true })
  enabled!: boolean;

  /** 同模型多条规则时，越大越优先；相同时更具体的 client_id 优先 */
  @Prop({ default: 0 })
  priority!: number;

  @Prop()
  effective_from?: Date;

  @Prop()
  effective_until?: Date;

  @Prop({
    required: true,
    enum: ['fixed', 'weighted', 'primary_fallback', 'latency', 'cost'],
  })
  strategy_type!: 'fixed' | 'weighted' | 'primary_fallback' | 'latency' | 'cost';

  @Prop()
  fixed_provider?: string;

  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  weighted_targets?: { provider: string; weight: number }[];

  @Prop()
  primary_provider?: string;

  @Prop()
  fallback_provider?: string;

  /** primary_fallback：主权重，默认 100 */
  @Prop()
  primary_weight?: number;

  /** primary_fallback：备权重，默认 0（为 0 时仅走主，除非未配置 fallback） */
  @Prop()
  fallback_weight?: number;

  /** latency 策略：候选 provider 名称列表 */
  @Prop({ type: [String], default: [] })
  latency_targets?: string[];

  /** cost 策略：候选 provider 及其单价 */
  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  cost_targets?: { provider: string; costPerUnit: number }[];

  @Prop()
  note?: string;
}

export const ModelRoutingRuleSchema = SchemaFactory.createForClass(ModelRoutingRule);

ModelRoutingRuleSchema.index({ model_name: 1, enabled: 1 });
ModelRoutingRuleSchema.index({ model_name: 1, client_id: 1, enabled: 1 });
