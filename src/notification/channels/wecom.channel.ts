import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { SystemEvent } from '../events/system-event.types';
import {
  INotificationChannel,
  NotificationChannelType,
  ChannelResult,
} from './notification-channel.interface';

const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1000;

@Injectable()
export class WeComChannel implements INotificationChannel {
  readonly channelType = NotificationChannelType.WECOM;
  private readonly logger = new Logger(WeComChannel.name);

  async send(
    event: SystemEvent,
    config: Record<string, any>,
    _recipients: string[],
  ): Promise<ChannelResult> {
    const content = WeComChannel.formatMarkdown(event);
    const body = { msgtype: 'markdown', markdown: { content } };

    let lastError: string | undefined;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await axios.post(config.webhookUrl, body, { timeout: 10_000 });
        return { success: true, responseData: res.data };
      } catch (err: any) {
        lastError = err.message ?? String(err);
        this.logger.warn(
          `WeCom webhook attempt ${attempt}/${MAX_RETRIES} failed: ${lastError}`,
        );
        if (attempt < MAX_RETRIES) {
          await this.sleep(BACKOFF_BASE_MS * Math.pow(2, attempt - 1));
        }
      }
    }

    this.logger.error(`WeCom webhook failed after ${MAX_RETRIES} retries: ${lastError}`);
    return { success: false, error: lastError };
  }

  /** Build a markdown string containing event type, severity, timestamp, and payload summary. */
  static formatMarkdown(event: SystemEvent): string {
    const lines: string[] = [
      `**事件类型**: ${event.type}`,
      `**严重级别**: ${event.severity}`,
      `**时间**: ${event.timestamp instanceof Date ? event.timestamp.toISOString() : String(event.timestamp)}`,
    ];

    if (event.payload && typeof event.payload === 'object') {
      const entries = Object.entries(event.payload);
      if (entries.length > 0) {
        lines.push('**详情**:');
        for (const [key, value] of entries) {
          lines.push(`> ${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`);
        }
      }
    }

    return lines.join('\n');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
