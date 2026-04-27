import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AccountCostDailyDocument = HydratedDocument<AccountCostDaily>;

@Schema({ timestamps: true, collection: 'account_cost_daily' })
export class AccountCostDaily {
  @Prop({ required: true })
  account_id!: string;

  @Prop({ required: true, index: true })
  provider_name!: string;

  /** 日期字符串，格式 'YYYY-MM-DD' */
  @Prop({ required: true })
  date!: string;

  @Prop({ default: 0 })
  total_cost!: number;

  @Prop({ default: 0 })
  request_count!: number;

  @Prop({ default: 0 })
  success_count!: number;

  @Prop({ default: 0 })
  failure_count!: number;

  @Prop({ default: 0 })
  avg_latency_ms!: number;
}

export const AccountCostDailySchema =
  SchemaFactory.createForClass(AccountCostDaily);

// 唯一索引：每个账号每天一条记录
AccountCostDailySchema.index({ account_id: 1, date: 1 }, { unique: true });

// 查询索引：按 provider + 日期倒序查询
AccountCostDailySchema.index({ provider_name: 1, date: -1 });
