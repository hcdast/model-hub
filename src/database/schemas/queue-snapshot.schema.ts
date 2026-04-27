import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type QueueSnapshotDocument = HydratedDocument<QueueSnapshot>;

@Schema({ timestamps: false, collection: 'queue_snapshots' })
export class QueueSnapshot {
  @Prop({ required: true })
  timestamp!: Date;

  @Prop({ required: true })
  queueName!: string;

  @Prop({ required: true })
  featureType!: string;

  @Prop()
  provider?: string;

  @Prop({ default: 0 })
  waiting!: number;

  @Prop({ default: 0 })
  active!: number;

  @Prop({ default: 0 })
  completed!: number;

  @Prop({ default: 0 })
  failed!: number;

  @Prop({ default: 0 })
  delayed!: number;

  @Prop({ default: 0 })
  paused!: number;

  @Prop({ default: 0 })
  depth!: number;

  @Prop({ default: 0 })
  throughputPerMin!: number;
}

export const QueueSnapshotSchema =
  SchemaFactory.createForClass(QueueSnapshot);

QueueSnapshotSchema.index({ queueName: 1, timestamp: -1 });
QueueSnapshotSchema.index(
  { timestamp: 1 },
  { expireAfterSeconds: 7 * 86400 },
);
