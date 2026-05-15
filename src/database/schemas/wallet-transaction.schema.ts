import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type WalletTransactionDocument = HydratedDocument<WalletTransaction>;

/**
 * 钱包交易流水 Schema —— 记录所有余额变更操作，用于审计追踪。
 * 每次 credit/debit/freeze/unfreeze 操作都会生成一条流水记录。
 */
@Schema({ timestamps: true, collection: 'wallet_transactions' })
export class WalletTransaction {
  /** API Key（与 api_clients.apiKey 一致） */
  @Prop({ required: true })
  apiKey!: string;

  /** 交易类型：credit（充值）、debit（扣费）、freeze（冻结）、unfreeze（解冻） */
  @Prop({ required: true, enum: ['credit', 'debit', 'freeze', 'unfreeze'] })
  type!: string;

  /** 交易金额 */
  @Prop({ required: true })
  amount!: number;

  /** 交易前余额 */
  @Prop({ required: true })
  balanceBefore!: number;

  /** 交易后余额 */
  @Prop({ required: true })
  balanceAfter!: number;

  /** 关联的任务 ID */
  @Prop()
  relatedTaskId?: string;

  /** 交易原因说明 */
  @Prop()
  reason?: string;
}

export const WalletTransactionSchema =
  SchemaFactory.createForClass(WalletTransaction);

// 按客户端 + 创建时间查询交易记录
WalletTransactionSchema.index({ apiKey: 1, createdAt: -1 });
// 按关联任务 ID 查询
WalletTransactionSchema.index({ relatedTaskId: 1 });
