import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ApiClientDocument = HydratedDocument<ApiClient>;

@Schema({ timestamps: true, collection: 'api_clients' })
export class ApiClient {
  /** 公开 id，形如 mh_<ULID>；完整调用密钥为 `${clientId}.${secret}` */
  @Prop({ required: true, unique: true })
  clientId!: string;

  @Prop({ required: true })
  secretHash!: string;

  @Prop()
  name?: string;

  @Prop({ default: true })
  enabled!: boolean;

  /** 该 API 客户端提交任务时的默认优先级（0=最高, 100=最低） */
  @Prop({ default: 50, min: 0, max: 100 })
  defaultPriority!: number;

  /** 计费策略：internal（内部计费，走 Wallet 扣费）、external（仅记录用量）、exempt（完全免计费） */
  @Prop({ default: 'internal', enum: ['internal', 'external', 'exempt'] })
  billingPolicy!: string;

  /** Per-Key 限流策略 */
  @Prop({ type: Object, default: {} })
  rateLimits?: {
    /** 每秒最大请求数，默认 10 */
    maxQps?: number;
    /** 最大并发任务数，默认 50 */
    maxConcurrent?: number;
    /** 每日最大请求数，默认 10000 */
    maxDailyRequests?: number;
  };

  /** 模型白名单，支持通配符模式（如 `wavespeed-ai/*`）；空数组表示允许所有模型 */
  @Prop({ type: [String], default: [] })
  modelAllowlist?: string[];
}

export const ApiClientSchema = SchemaFactory.createForClass(ApiClient);
