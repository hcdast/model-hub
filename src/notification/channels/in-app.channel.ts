import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SystemEvent } from '../events/system-event.types';
import {
  INotificationChannel,
  NotificationChannelType,
  ChannelResult,
} from './notification-channel.interface';
import {
  InAppNotification,
  InAppNotificationDocument,
} from '../../database/schemas/in-app-notification.schema';

@Injectable()
export class InAppChannel implements INotificationChannel {
  readonly channelType = NotificationChannelType.IN_APP;

  constructor(
    @InjectModel(InAppNotification.name)
    private readonly inAppModel: Model<InAppNotificationDocument>,
  ) {}

  async send(
    event: SystemEvent,
    _config: Record<string, any>,
    _recipients: string[],
  ): Promise<ChannelResult> {
    const { title, message } = InAppChannel.buildTitleAndMessage(event);

    await this.inAppModel.create({
      eventType: event.type,
      severity: event.severity,
      title,
      message,
      payload: event.payload,
      read: false,
    });

    return { success: true };
  }

  /** Derive a human-readable title and message from a system event. */
  static buildTitleAndMessage(event: SystemEvent): { title: string; message: string } {
    const title = `[${event.severity.toUpperCase()}] ${event.type}`;
    const payloadSummary = Object.entries(event.payload ?? {})
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
      .join(', ');
    const ts = event.timestamp instanceof Date ? event.timestamp.toISOString() : String(event.timestamp);
    const message = `${ts} - ${payloadSummary || 'No details'}`;
    return { title, message };
  }
}
