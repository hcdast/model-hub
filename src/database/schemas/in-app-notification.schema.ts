import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import {
  SystemEventType,
  EventSeverity,
} from '../../notification/events/system-event.types';

export type InAppNotificationDocument = HydratedDocument<InAppNotification>;

@Schema({ timestamps: true, collection: 'in_app_notifications' })
export class InAppNotification {
  @Prop({ required: true, enum: Object.values(SystemEventType) })
  eventType!: string;

  @Prop({ required: true, enum: Object.values(EventSeverity) })
  severity!: string;

  @Prop({ required: true })
  title!: string;

  @Prop({ required: true })
  message!: string;

  @Prop({ type: Object })
  payload?: Record<string, any>;

  @Prop({ default: false })
  read!: boolean;

  @Prop()
  readAt?: Date;
}

export const InAppNotificationSchema =
  SchemaFactory.createForClass(InAppNotification);

InAppNotificationSchema.index({ read: 1 });
InAppNotificationSchema.index({ createdAt: -1 });
