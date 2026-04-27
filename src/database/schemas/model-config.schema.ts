import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type ModelConfigDocument = HydratedDocument<ModelConfig>;

/**
 * 模型配置 Schema —— 与 AGI-Content 的 aimodelconfigs 集合完全对齐。
 * 数据从 AGI-Content 的枚举文件（imageGenEnum / imageToVideoEnum / characterSwapEnum）
 * 通过 importAiModelConfigs.js 脚本导入，或由 Model-Hub 管理后台维护。
 */
@Schema({ timestamps: false, versionKey: false, collection: 'model_configs' })
export class ModelConfig {
  // ===== 基础标识 =====
  @Prop({ required: true, index: true })
  model_name!: string;

  @Prop({ required: true, index: true })
  model_type!: number;

  @Prop({ required: true, index: true })
  provider!: string;

  // provider_model_name: 提供商的模型标识符，用于路由和调用
  // 这个字段应该是唯一的，因为它是完整的模型路径
  @Prop({ unique: true, sparse: true, index: true })
  provider_model_name?: string;

  @Prop({ default: '' })
  group!: string;

  @Prop({ required: true })
  label!: string;

  @Prop({ default: '' })
  description!: string;

  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  tags!: any[];

  @Prop({ default: 0 })
  sort!: number;

  @Prop({ default: false })
  disabled!: boolean;

  @Prop({ default: false })
  unusable!: boolean;

  @Prop({ default: true })
  display!: boolean;

  // ===== 服务配置 =====
  @Prop({ default: '' })
  service!: string;

  // ===== 计费配置 =====
  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  unit_credit_map!: Record<string, any>;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  unit_price_map!: Record<string, any>;

  @Prop({ default: 5 })
  duration_step!: number;

  @Prop({ default: 1 })
  audio_extra_credit_multiplier!: number;

  @Prop({ type: MongooseSchema.Types.Mixed })
  discount?: Record<string, any>;

  // ===== 访问控制 =====
  @Prop({ default: false })
  requires_pay!: boolean;

  @Prop({ default: 10 })
  requires_priority!: number;

  @Prop({ default: -1 })
  requires_priority_4_unlimit_mode!: number;

  @Prop()
  requires_priority_4_unlimit_mode_monthly?: number;

  @Prop()
  requires_priority_4_unlimit_mode_yearly?: number;

  @Prop({ default: false })
  supported_unlimit_mode!: boolean;

  @Prop({ default: 0 })
  supported_unlimit_mode_start_time!: number;

  @Prop({ type: MongooseSchema.Types.Mixed })
  supported_unlimit_days_monthly?: Record<string, any>;

  @Prop({ type: MongooseSchema.Types.Mixed })
  supported_unlimit_days_yearly?: Record<string, any>;

  // ===== 功能开关 =====
  @Prop({ default: false })
  supported_last_frame!: boolean;

  @Prop({ default: false })
  supported_first_frame!: boolean;

  @Prop({ default: false })
  supported_extend_prompt!: boolean;

  @Prop({ default: false })
  supported_reference!: boolean;

  @Prop({ default: false })
  supported_variation!: boolean;

  @Prop({ default: false })
  supported_keep_original_sound!: boolean;

  @Prop({ default: false })
  supported_web_search!: boolean;

  @Prop({ default: false })
  is_akool_tp!: boolean;

  @Prop({ default: false })
  is_extend_model!: boolean;

  @Prop({ default: false })
  is_sd2!: boolean;

  @Prop({ default: false })
  supports_elements!: boolean;

  @Prop({ default: false })
  supports_reference!: boolean;

  @Prop({ default: false })
  supports_inline_media!: boolean;

  @Prop({ default: false })
  support_all_in_one_reference!: boolean;

  // ===== 数量与限制 =====
  @Prop({ default: 4 })
  max_count!: number;

  @Prop({ type: [Number], default: [1] })
  batch_quantity!: number[];

  @Prop()
  max_resource_count?: number;

  @Prop({ type: MongooseSchema.Types.Mixed })
  lock_duration_limit?: Record<string, any>;

  // ===== 完整参数配置 =====
  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  params!: Record<string, any>;

  // ===== 元数据 =====
  @Prop({ default: () => Date.now() })
  create_time!: number;

  @Prop({ default: () => Date.now() })
  update_time!: number;
}

export const ModelConfigSchema = SchemaFactory.createForClass(ModelConfig);

// 复合唯一索引：model_name + model_type + service 组合唯一
ModelConfigSchema.index({ model_name: 1, model_type: 1, service: 1 }, { unique: true });

// 其他查询索引
ModelConfigSchema.index({ model_type: 1, disabled: 1, sort: -1 });
ModelConfigSchema.index({ provider: 1, model_type: 1 });
ModelConfigSchema.index({ create_time: -1 });

ModelConfigSchema.pre('save', function (next) {
  (this as any).update_time = Date.now();
  next();
});

ModelConfigSchema.pre('findOneAndUpdate', function (next) {
  this.set({ update_time: Date.now() });
  next();
});
