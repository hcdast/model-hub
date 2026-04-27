import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import {
  SystemEventType,
  EventSeverity,
} from '../../notification/events/system-event.types';
import { NotificationChannelType } from './notification-rule.schema';

export type NotificationRecordDocument = HydratedDocument<NotificationRecord>;

export enum NotificationDispatchStatus {
  SUCCESS = 'success',
  FAILED = 'failed',
  SUPPRESSED = 'suppressed',
}

@Schema({ timestamps: true, collection: 'notification_records' })
export class NotificationRecord {
  @Prop({ required: true })
  ruleId!: string;

  @Prop({ required: true })
  ruleName!: string;

  @Prop({ required: true, enum: Object.values(SystemEventType) })
  eventType!: string;

  @Prop({ required: true, enum: Object.values(EventSeverity) })
  severity!: string;

  @Prop({ required: true, enum: Object.values(NotificationChannelType) })
  channelType!: string;

  @Prop({
    required: true,
    enum: Object.values(NotificationDispatchStatus),
  })
  status!: string;

  @Prop({ default: 1 })
  attemptCount!: number;

  @Prop()
  error?: string;

  @Prop({ type: Object })
  eventPayload?: Record<string, any>;

  @Prop({ default: 0 })
  suppressedCount!: number;
}

export const NotificationRecordSchema =
  SchemaFactory.createForClass(NotificationRecord);

NotificationRecordSchema.index({ eventType: 1 });
NotificationRecordSchema.index({ channelType: 1 });
NotificationRecordSchema.index({ status: 1 });
NotificationRecordSchema.index({ createdAt: -1 });
