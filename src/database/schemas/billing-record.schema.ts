import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type BillingRecordDocument = HydratedDocument<BillingRecord>;

/**
 * 计费记录 Schema —— 记录每笔 API 调用的用量和费用。
 * internal 和 external 策略的任务均会创建记录，exempt 策略不创建。
 */
@Schema({ timestamps: true, collection: 'billing_records' })
export class BillingRecord {
  /** 关联的任务 ID */
  @Prop({ required: true })
  taskId!: string;

  /** API Client ID */
  @Prop({ required: true })
  clientId!: string;

  /** 模型名称 */
  @Prop({ required: true })
  model!: string;

  /** 供应商标识 */
  @Prop({ required: true })
  provider!: string;

  /** 用量类型：token（LLM 按 token）、count（图像按次）、duration（视频按时长） */
  @Prop({ required: true, enum: ['token', 'count', 'duration'] })
  usageType!: string;

  /** 预估用量 */
  @Prop({ default: 0 })
  estimatedUsage!: number;

  /** 实际用量 */
  @Prop({ default: 0 })
  actualUsage!: number;

  /** 单价 */
  @Prop({ required: true, default: 0 })
  unitPrice!: number;

  /** 预估费用 = unitPrice × estimatedUsage */
  @Prop({ default: 0 })
  estimatedCost!: number;

  /** 实际费用 = unitPrice × actualUsage */
  @Prop({ default: 0 })
  actualCost!: number;

  /** 货币单位，默认 credit */
  @Prop({ default: 'credit' })
  currency!: string;

  /** 计费策略：internal（内部计费）、external（仅记录用量） */
  @Prop({ required: true, enum: ['internal', 'external'] })
  billingPolicy!: string;

  /** 计费状态 */
  @Prop({
    required: true,
    enum: ['estimated', 'pre_deducted', 'settled', 'refunded', 'failed'],
  })
  status!: string;

  /** 结算时间 */
  @Prop()
  settledAt?: Date;

  /** 退款时间 */
  @Prop()
  refundedAt?: Date;

  /** 失败原因 */
  @Prop()
  failReason?: string;
}

export const BillingRecordSchema =
  SchemaFactory.createForClass(BillingRecord);

// taskId 唯一索引：每个任务只有一条计费记录
BillingRecordSchema.index({ taskId: 1 }, { unique: true });
// 按客户端 + 创建时间查询
BillingRecordSchema.index({ clientId: 1, createdAt: -1 });
// 按计费策略 + 状态查询
BillingRecordSchema.index({ billingPolicy: 1, status: 1 });
// 按模型 + 创建时间查询
BillingRecordSchema.index({ model: 1, createdAt: -1 });
