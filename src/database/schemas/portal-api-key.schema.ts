/*
 * Portal API Key Schema
 * 开发者门户用户 API Key 管理
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PortalApiKeyDocument = HydratedDocument<PortalApiKey>;

@Schema({ timestamps: true, collection: 'portal_api_keys' })
export class PortalApiKey {
  @Prop({ required: true })
  userId!: string;
  @Prop({ required: true, min: 0 })
  slot!: number;


  @Prop({ required: true, unique: true })
  keyId!: string;

  @Prop({ required: true, select: false })
  secretHash!: string;

  @Prop({ required: true })
  maskedKey!: string;

  @Prop({ required: true, unique: true })
  billingKey!: string;

  @Prop({ required: true, trim: true })
  name!: string;  // 用户自定义名称，如 "My App", "Development"

  @Prop({ type: [String], default: [] })
  modelAllowlist!: string[];

  @Prop({ default: 'internal', enum: ['internal', 'external', 'exempt'] })
  billingPolicy!: 'internal' | 'external' | 'exempt';
  @Prop({ type: [String], default: ['*'] })
  permissions!: string[];  // 权限列表，['*'] 表示全部权限

  @Prop({ default: true })
  enabled!: boolean;

  @Prop()
  lastUsedAt?: Date;

  @Prop()
  lastUsedIp?: string;

  @Prop()
  expiresAt?: Date;  // 过期时间，null 表示永不过期

  @Prop({ type: Object, default: {} })
  rateLimit!: {
    maxQps?: number;
    maxDailyRequests?: number;
  };

  // timestamps 会自动添加
  createdAt?: Date;
  updatedAt?: Date;
}

export const PortalApiKeySchema = SchemaFactory.createForClass(PortalApiKey);

// 索引
PortalApiKeySchema.index({ userId: 1, createdAt: -1 });
PortalApiKeySchema.index(
  { userId: 1, slot: 1 },
  {
    unique: true,
    partialFilterExpression: { slot: { $type: 'number' } },
  },
);
PortalApiKeySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
