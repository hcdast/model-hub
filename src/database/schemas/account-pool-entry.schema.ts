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
