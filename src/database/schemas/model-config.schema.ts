import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type ModelConfigDocument = HydratedDocument<ModelConfig>;

/**
 * 模型配置 Schema —— collection: model_configs。
 * 计费以 unit_price_map（含 mandatory default 档）为唯一来源。
 */
@Schema({ timestamps: false, versionKey: false, collection: 'model_configs' })
export class ModelConfig {
  /** 与创建任务请求体 `model` 一致（含 `/` 的路径） */
  @Prop({ required: true, index: true })
  model_id!: string;

  /** camelCase 能力类型，与 options.featureType 一致 */
  @Prop({ required: true, index: true })
  model_type!: string;

  /** ProviderRegistry 中的 Adapter 名 */
  @Prop({ required: true, index: true })
  provider!: string;

  @Prop({ unique: true, sparse: true, index: true })
  provider_model_name?: string;

  /** 展示名称 */
  @Prop({ required: true })
  model_name!: string;

  @Prop({ default: '' })
  description!: string;

  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  tags!: any[];

  @Prop({ default: 0 })
  sort!: number;

  @Prop({ default: false })
  disabled!: boolean;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  unit_price_map!: Record<string, any>;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  params!: Record<string, any>;

  @Prop({ default: () => Date.now() })
  create_time!: number;

  @Prop({ default: () => Date.now() })
  update_time!: number;
}

export const ModelConfigSchema = SchemaFactory.createForClass(ModelConfig);

/** model_id 非唯一；一条配置以 provider_model_name 唯一标识 */
ModelConfigSchema.index({ model_id: 1, model_type: 1 });
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
