import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ProviderRuntimeConfigDocument = HydratedDocument<ProviderRuntimeConfig>;

@Schema({ timestamps: true, collection: 'provider_runtime_configs' })
export class ProviderRuntimeConfig {
  @Prop({ required: true, unique: true, index: true })
  provider_name!: string;

  @Prop({ default: true })
  enabled!: boolean;

  /** 厂商图标 URL */
  @Prop()
  icon_url?: string;

  @Prop()
  base_url?: string;

  /**
   * @deprecated 密钥已统一收敛到 account_pool_entries，此字段仅在过渡期保留。
   * 迁移完成后将通过 cleanup 脚本移除。请使用 AccountPoolEntry.api_key 代替。
   * 明文存储；生产建议后续接 KMS 或字段加密
   */
  @Prop()
  api_key?: string;

  @Prop({ type: Object, default: {} })
  extra?: Record<string, unknown>;

  /** 创建任务 / submit 路径限流 */
  @Prop({ type: Object, default: {} })
  limits?: {
    max_concurrent?: number;
    max_per_second?: number;
    max_per_minute?: number;
  };

  /** 轮询 query 路径限流；未配置时由服务层回退为与 limits 一致 */
  @Prop({ type: Object, default: {} })
  poll_limits?: {
    max_per_second?: number;
    max_concurrent?: number;
  };

  @Prop({ default: 0 })
  revision!: number;
}

export const ProviderRuntimeConfigSchema =
  SchemaFactory.createForClass(ProviderRuntimeConfig);
