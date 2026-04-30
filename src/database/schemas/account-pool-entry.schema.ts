import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AccountPoolEntryDocument = HydratedDocument<AccountPoolEntry>;

@Schema({ timestamps: true, collection: 'account_pool_entries' })
export class AccountPoolEntry {
  @Prop({ required: true, index: true })
  provider_name!: string;

  @Prop({ required: true })
  account_alias!: string;

  /** 明文存储；生产建议后续接 KMS 或字段加密 */
  @Prop({ required: true })
  api_key!: string;

  @Prop()
  base_url?: string;

  /**
   * 扩展认证字段，支持 tencent-cloud 等需要多个认证参数的厂商
   * 示例: { secretId: "AKIDxxx", secretKey: "4vl6xxx", region: "ap-guangzhou" }
   */
  @Prop({ type: Object, default: {} })
  extra_credentials!: Record<string, unknown>;

  /** 账号描述，便于管理员识别用途 */
  @Prop({ default: '' })
  description!: string;

  @Prop({ default: 1 })
  weight!: number;

  @Prop({ default: true })
  enabled!: boolean;

  @Prop({ default: 'closed', enum: ['closed', 'open', 'half-open'] })
  health_status!: string;

  @Prop({ default: 0 })
  daily_cost_limit!: number;

  @Prop({ default: 0 })
  monthly_cost_limit!: number;

  @Prop({ type: [String], default: [] })
  tags!: string[];

  @Prop({ type: Object, default: {} })
  metadata!: Record<string, unknown>;

  @Prop({ default: 0 })
  revision!: number;
}

export const AccountPoolEntrySchema =
  SchemaFactory.createForClass(AccountPoolEntry);

// 查询索引：按 provider + enabled 筛选活跃账号
AccountPoolEntrySchema.index({ provider_name: 1, enabled: 1 });

// 唯一索引：同一 provider 下 api_key 不可重复
AccountPoolEntrySchema.index({ provider_name: 1, api_key: 1 }, { unique: true });

// 唯一索引：同一 provider 下 account_alias 不可重复
AccountPoolEntrySchema.index(
  { provider_name: 1, account_alias: 1 },
  { unique: true },
);
