import { Process, Processor } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Job } from 'bull';
import {
  NotificationRecord,
  NotificationRecordDocument,
  NotificationDispatchStatus,
} from '../../database/schemas/notification-record.schema';
import {
  NotificationChannelType,
} from '../../database/schemas/notification-rule.schema';
import {
  INotificationChannel,
} from '../channels/notification-channel.interface';
import { WeComChannel } from '../channels/wecom.channel';
import { EmailChannel } from '../channels/email.channel';
import { InAppChannel } from '../channels/in-app.channel';
import { NotificationJobData } from '../services/notification.service';

@Injectable()
@Processor('notification')
export class NotificationProcessor {
  private readonly logger = new Logger(NotificationProcessor.name);
  private readonly channelMap: Map<NotificationChannelType, INotificationChannel>;

  constructor(
    @InjectModel(NotificationRecord.name)
    private readonly recordModel: Model<NotificationRecordDocument>,
    private readonly wecomChannel: WeComChannel,
    private readonly emailChannel: EmailChannel,
    private readonly inAppChannel: InAppChannel,
  ) {
    this.channelMap = new Map<NotificationChannelType, INotificationChannel>([
      [NotificationChannelType.WECOM, this.wecomChannel],
      [NotificationChannelType.EMAIL, this.emailChannel],
      [NotificationChannelType.IN_APP, this.inAppChannel],
    ]);
  }

  @Process('dispatch')
  async handleDispatch(job: Job<NotificationJobData>): Promise<void> {
    const { event, ruleId, ruleName, channelType, channelConfig, recipients } = job.data;
    const attempt = job.attemptsMade + 1;

    const channel = this.channelMap.get(channelType as NotificationChannelType);
    if (!channel) {
      this.logger.error(`Unknown channel type: ${channelType}`);
      await this.createRecord({
        ruleId,
        ruleName,
        eventType: event.type,
        severity: event.severity,
        channelType,
        status: NotificationDispatchStatus.FAILED,
        attemptCount: attempt,
        error: `Unknown channel type: ${channelType}`,
        eventPayload: event.payload,
      });
      return;
    }

    try {
      const result = await channel.send(event, channelConfig, recipients);

      if (result.success) {
        await this.createRecord({
          ruleId,
          ruleName,
          eventType: event.type,
          severity: event.severity,
          channelType,
          status: NotificationDispatchStatus.SUCCESS,
          attemptCount: attempt,
          eventPayload: event.payload,
        });
      } else {
        await this.createRecord({
          ruleId,
          ruleName,
          eventType: event.type,
          severity: event.severity,
          channelType,
          status: NotificationDispatchStatus.FAILED,
          attemptCount: attempt,
          error: result.error,
          eventPayload: event.payload,
        });
        // Throw to trigger Bull retry
        throw new Error(result.error ?? 'Channel send failed');
      }
    } catch (error) {
      const errMsg = (error as Error).message;
      this.logger.warn(
        `Notification dispatch failed: rule=${ruleName} channel=${channelType} attempt=${attempt} error=${errMsg}`,
      );
      throw error;
    }
  }

  private async createRecord(data: {
    ruleId: string;
    ruleName: string;
    eventType: string;
    severity: string;
    channelType: string;
    status: NotificationDispatchStatus;
    attemptCount: number;
    error?: string;
    eventPayload?: Record<string, any>;
    suppressedCount?: number;
  }): Promise<void> {
    try {
      await this.recordModel.create({
        ...data,
        suppressedCount: data.suppressedCount ?? 0,
      });
    } catch (err) {
      this.logger.error(
        `Failed to create notification record: ${(err as Error).message}`,
      );
    }
  }
}
