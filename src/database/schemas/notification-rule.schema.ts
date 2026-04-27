import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import {
  SystemEventType,
  EventSeverity,
} from '../../notification/events/system-event.types';

export type NotificationRuleDocument = HydratedDocument<NotificationRule>;

export enum NotificationChannelType {
  WECOM = 'wecom',
  EMAIL = 'email',
  IN_APP = 'in_app',
}

@Schema({ timestamps: true, collection: 'notification_rules' })
export class NotificationRule {
  @Prop({ required: true })
  name!: string;

  @Prop({ default: true })
  enabled!: boolean;

  @Prop({ type: [String], enum: Object.values(SystemEventType), default: [] })
  eventTypes!: string[];

  @Prop({ type: [String], enum: Object.values(EventSeverity), default: [] })
  severities!: string[];

  @Prop({ required: true, enum: Object.values(NotificationChannelType) })
  channelType!: string;

  @Prop({ type: Object, required: true })
  channelConfig!: Record<string, any>;

  @Prop({ type: [String], default: [] })
  recipients!: string[];

  @Prop({ default: 0 })
  cooldownMs!: number;

  @Prop({ default: 0 })
  aggregationWindowMs!: number;

  @Prop({ default: 0 })
  maxCountPerWindow!: number;
}

export const NotificationRuleSchema =
  SchemaFactory.createForClass(NotificationRule);

NotificationRuleSchema.index({ enabled: 1 });
NotificationRuleSchema.index({ channelType: 1 });
