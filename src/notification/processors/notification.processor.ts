import { Process, Processor } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
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
    let checkpoint = job.data.delivery;
    if (!checkpoint) {
      checkpoint = { recordId: new Types.ObjectId().toHexString(), attempt: job.attemptsMade + 1, phase: 'prepared' };
      await job.update({ ...job.data, delivery: checkpoint });
    }
    const filter = { _id: new Types.ObjectId(checkpoint.recordId) };
    if (checkpoint.phase === 'sending') {
      // A worker may have died after the external side effect. Never blindly resend.
      await this.writeRecord(() => this.recordModel.updateOne(filter, { $set: {
        status: NotificationDispatchStatus.UNKNOWN, error: '投递过程被中断，结果待核验；已停止自动重发',
      } }));
      job.discard();
      throw new Error('通知投递结果待核验，禁止自动重发');
    }
    if (checkpoint.phase === 'prepared') {
      // Persist an audit anchor before any external side effect; failure prevents sending.
      await this.writeRecord(() => this.recordModel.updateOne(filter, { $setOnInsert: {
        ruleId, ruleName, eventType: event.type, severity: event.severity, channelType,
        queueJobId: job.id == null ? undefined : String(job.id), queueName: job.queue?.name,
        status: NotificationDispatchStatus.PENDING, attemptCount: checkpoint!.attempt,
        eventPayload: event.payload, suppressedCount: 0,
        error: '尚未确认投递结果；队列异常中断时需核验',
      } }, { upsert: true }));
      checkpoint = { ...checkpoint, phase: 'sending' };
      await job.update({ ...job.data, delivery: checkpoint });
      const channel = this.channelMap.get(channelType as NotificationChannelType);
      let result: { success: boolean; retryable?: boolean; error?: string };
      try {
        if (!channel) result = { success: false, retryable: false, error: '未知通知渠道' };
        else {
          const response = await channel.send(event, channelConfig, recipients);
          result = { success: response.success, retryable: response.retryable, error: response.error };
        }
      } catch { result = { success: false, error: '通知渠道执行异常' }; }
      // Keep only the receipt, never channel responses/addresses/credentials.
      checkpoint = { ...checkpoint, phase: 'receipt', result };
      await job.update({ ...job.data, delivery: checkpoint });
    }
    const result = checkpoint.result!;
    // A DB outage retries this write using the durable receipt, without calling the channel.
    await this.writeRecord(async () => {
      const updated = await this.recordModel.updateOne(filter, { $set: {
        status: result.success ? NotificationDispatchStatus.SUCCESS : NotificationDispatchStatus.FAILED,
        error: result.error || '',
      } });
      if (updated.matchedCount !== 1) throw new Error('Missing notification audit anchor');
    });
    if (!result.success && result.retryable !== false) {
      // The previous attempt is durably recorded before admitting another delivery attempt.
      const { delivery: _, ...data } = job.data;
      await job.update(data);
      throw new Error(result.error || '通知渠道投递失败');
    }
  }

  private async writeRecord(write: () => PromiseLike<unknown>): Promise<void> {
    try { await write(); }
    catch {
      this.logger.error('Notification audit write failed; job must not complete');
      throw new Error('通知审计记录写入失败，等待队列重试');
    }
  }
}
