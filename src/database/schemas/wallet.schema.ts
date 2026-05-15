import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type WalletDocument = HydratedDocument<Wallet>;

/**
 * 钱包 Schema —— 为每个 billingPolicy=internal 的 API 客户端（按 apiKey）维护独立余额。
 * 可用余额 = balance - frozenAmount
 */
@Schema({ timestamps: true, collection: 'wallets' })
export class Wallet {
  /** API 客户端主键（与 api_clients.apiKey 一致），每个客户端唯一 */
  @Prop({ required: true, unique: true, index: true })
  apiKey!: string;

  /** 账户余额 */
  @Prop({ required: true, default: 0 })
  balance!: number;

  /** 冻结金额（预扣费占用） */
  @Prop({ required: true, default: 0 })
  frozenAmount!: number;

  /** 低余额告警阈值 */
  @Prop({ default: 0 })
  lowBalanceThreshold!: number;
}

export const WalletSchema = SchemaFactory.createForClass(Wallet);
