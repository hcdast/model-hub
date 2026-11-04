import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { SystemEvent } from '../events/system-event.types';
import {
  INotificationChannel,
  NotificationChannelType,
  ChannelResult,
} from './notification-channel.interface';

const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1000;
const escapeHtml = (value: unknown) => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

@Injectable()
export class EmailChannel implements INotificationChannel {
  readonly channelType = NotificationChannelType.EMAIL;
  private readonly logger = new Logger(EmailChannel.name);

  async send(
    event: SystemEvent,
    config: Record<string, any>,
    recipients: string[],
  ): Promise<ChannelResult> {
    const subject = EmailChannel.formatSubject(event);
    const html = EmailChannel.formatHtmlBody([event]);

    return this.sendMail(config, recipients, subject, html);
  }

  /** Send a digest email for multiple aggregated events of the same type. */
  async sendDigest(
    events: SystemEvent[],
    config: Record<string, any>,
    recipients: string[],
  ): Promise<ChannelResult> {
    if (events.length === 0) {
      return { success: true };
    }
    const first = events[0];
    const subject = `[聚合通知] ${first.type} (${first.severity}) - ${events.length} 条事件`;
    const html = EmailChannel.formatHtmlBody(events);

    return this.sendMail(config, recipients, subject, html);
  }

  static formatSubject(event: SystemEvent): string {
    return `[${event.severity.toUpperCase()}] ${event.type}`;
  }

  static formatHtmlBody(events: SystemEvent[]): string {
    const rows = events
      .map((e) => {
        const payloadHtml = Object.entries(e.payload ?? {})
          .map(([k, v]) => `<li><strong>${escapeHtml(k)}</strong>: ${escapeHtml(typeof v === 'object' ? JSON.stringify(v) : v)}</li>`)
          .join('');
        const ts = e.timestamp instanceof Date && !isNaN(e.timestamp.getTime())
          ? e.timestamp.toISOString()
          : String(e.timestamp);
        return `<div style="margin-bottom:16px;padding:12px;border:1px solid #e0e0e0;border-radius:4px;">
  <p><strong>事件类型:</strong> ${escapeHtml(e.type)}</p>
  <p><strong>严重级别:</strong> ${escapeHtml(e.severity)}</p>
  <p><strong>时间:</strong> ${escapeHtml(ts)}</p>
  <ul>${payloadHtml}</ul>
</div>`;
      })
      .join('\n');

    return `<html><body>
<h2>系统通知 (${events.length} 条)</h2>
${rows}
</body></html>`;
  }

  private async sendMail(
    config: Record<string, any>,
    recipients: string[],
    subject: string,
    html: string,
  ): Promise<ChannelResult> {
    const transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpPort === 465,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      auth: { user: config.smtpUser, pass: config.smtpPass },
    });

    let lastError: string | undefined;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const info = await transporter.sendMail({
          from: config.from,
          to: recipients.join(','),
          subject,
          html,
        });
        if (Array.isArray(info.rejected) && info.rejected.length) {
          // Do not retry recipients already accepted by SMTP, which would duplicate mail.
          return { success: false, retryable: false, error: `SMTP 部分投递失败：${info.rejected.length} 个接收方被拒绝` };
        }
        if (!Array.isArray(info.accepted) || info.accepted.length === 0) return { success: false, error: 'SMTP 未接受任何接收方' };
        return { success: true, responseData: info };
      } catch (err: any) {
        const code = /^[A-Z_]{2,24}$/.test(err.code || '') ? err.code : 'UNKNOWN';
        const responseCode = Number.isInteger(err.responseCode) ? ` / ${err.responseCode}` : '';
        lastError = `SMTP 投递失败（${code}${responseCode}）`;
        this.logger.warn(`Email send attempt ${attempt}/${MAX_RETRIES} failed: ${lastError}`);
        if (attempt < MAX_RETRIES) {
          await this.sleep(BACKOFF_BASE_MS * Math.pow(2, attempt - 1));
        }
      }
    }

    this.logger.error(`Email send failed after ${MAX_RETRIES} retries: ${lastError}`);
    return { success: false, error: lastError };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
