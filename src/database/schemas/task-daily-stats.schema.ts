import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type TaskDailyStatsDocument = HydratedDocument<TaskDailyStats>;

@Schema({ timestamps: true, collection: 'task_daily_stats' })
export class TaskDailyStats {
  @Prop({ required: true })
  date!: string;

  @Prop({ required: true })
  featureType!: string;

  @Prop({ required: true })
  provider!: string;

  @Prop({ required: true })
  model!: string;

  @Prop({ default: 0 })
  totalCount!: number;

  @Prop({ default: 0 })
  successCount!: number;

  @Prop({ default: 0 })
  failedCount!: number;

  @Prop({ default: 0 })
  timeoutCount!: number;

  @Prop({ default: 0 })
  cancelledCount!: number;

  @Prop({ default: 0 })
  avgQueueWaitMs!: number;

  @Prop({ default: 0 })
  avgProviderProcessMs!: number;

  @Prop({ default: 0 })
  avgTotalE2eMs!: number;

  @Prop({ default: 0 })
  p50E2eMs!: number;

  @Prop({ default: 0 })
  p95E2eMs!: number;

  @Prop({ default: 0 })
  p99E2eMs!: number;

  @Prop({ default: 0 })
  maxE2eMs!: number;

  @Prop({ default: 0 })
  callbackSuccessCount!: number;

  @Prop({ default: 0 })
  callbackFailedCount!: number;
}

export const TaskDailyStatsSchema =
  SchemaFactory.createForClass(TaskDailyStats);

TaskDailyStatsSchema.index(
  { date: 1, featureType: 1, provider: 1, model: 1 },
  { unique: true },
);
TaskDailyStatsSchema.index({ date: -1 });
TaskDailyStatsSchema.index({ featureType: 1, date: -1 });
