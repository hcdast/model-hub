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

  /** Provider 成本配置；用于 cost-based 路由策略的决策依据 */
  @Prop({ type: Object, default: {} })
  cost_config?: {
    /** 每次调用成本 */
    cost_per_unit?: number;
    /** 计费单位: 'per_call' | 'per_token' | 'per_second' */
    cost_unit?: string;
  };

  /** 熔断器配置；按 Provider 覆盖系统默认值，未设置的字段使用默认值 */
  @Prop({ type: Object, default: {} })
  circuit_breaker?: {
    /** 错误率阈值（百分比），取值 1-100，默认 50 */
    error_rate_threshold?: number;
    /** 连续失败次数阈值，正整数，默认 5 */
    consecutive_failure_threshold?: number;
    /** 熔断冷却时间（毫秒），取值 5000-300000，默认 30000 */
    cooldown_duration_ms?: number;
    /** HALF_OPEN 状态下探针请求数量，正整数，默认 3 */
    probe_request_count?: number;
    /** 滑动窗口持续时间（毫秒），正整数，默认 300000 */
    sliding_window_duration_ms?: number;
    /** 最小样本数，低于此值不触发熔断，正整数，默认 10 */
    min_sample_count?: number;
  };

  @Prop({ default: 0 })
  revision!: number;
}

export const ProviderRuntimeConfigSchema =
  SchemaFactory.createForClass(ProviderRuntimeConfig);
