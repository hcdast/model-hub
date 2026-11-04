import { BadRequestException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectQueue } from '@nestjs/bull';
import { Model, FilterQuery } from 'mongoose';
import { Queue } from 'bull';
import { SystemEventType, EventSeverity, SystemEvent } from '../events/system-event.types';
import {
  NotificationRule,
  NotificationRuleDocument,
  NotificationChannelType,
} from '../../database/schemas/notification-rule.schema';
import {
  NotificationRecord,
  NotificationRecordDocument,
  NotificationDispatchStatus,
} from '../../database/schemas/notification-record.schema';
import { RuleMatcherService } from './rule-matcher.service';
import { NotificationRateLimiterService } from './notification-rate-limiter.service';
import {
  validateChannelConfig,
} from './channel-config-validator';

export interface NotificationJobData {
  event: SystemEvent;
  ruleId: string;
  ruleName: string;
  channelType: NotificationChannelType;
  channelConfig: Record<string, any>;
  recipients: string[];
}

export interface RecordFilters {
  eventType?: string;
  channelType?: string;
  status?: string;
  startTime?: Date;
  endTime?: Date;
}

export interface PaginatedResult<T = any> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectModel(NotificationRule.name)
    private readonly ruleModel: Model<NotificationRuleDocument>,
    @InjectModel(NotificationRecord.name)
    private readonly recordModel: Model<NotificationRecordDocument>,
    private readonly ruleMatcher: RuleMatcherService,
    private readonly rateLimiter: NotificationRateLimiterService,
    @InjectQueue('notification') private readonly notificationQueue: Queue,
  ) {}

  /**
   * Core orchestration: load enabled rules → match → rate limit check → enqueue to Bull.
   */
  async processEvent(event: SystemEvent): Promise<void> {
    try {
      const allRules = await this.ruleModel.find({ enabled: true }).lean().exec();
      const matched = this.ruleMatcher.matchRules(event, allRules as NotificationRule[]);

      if (matched.length === 0) {
        return;
      }

      for (const rule of matched) {
        await this.dispatchOrSuppress(event, rule);
      }
    } catch (error) {
      this.logger.error(
        `Failed to process event ${event.type}: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  private async dispatchOrSuppress(event: SystemEvent, rule: NotificationRule): Promise<void> {
    const ruleId = (rule as any)._id?.toString() ?? (rule as any).id ?? '';
    const ruleName = rule.name;

    // Check cooldown
    if (rule.cooldownMs > 0) {
      const inCooldown = await this.rateLimiter.isInCooldown(ruleId, event.type, rule.cooldownMs);
      if (inCooldown) {
        await this.recordModel.create({
          ruleId,
          ruleName,
          eventType: event.type,
          severity: event.severity,
          channelType: rule.channelType,
          status: NotificationDispatchStatus.SUPPRESSED,
          attemptCount: 0,
          eventPayload: event.payload,
          suppressedCount: 1,
        });
        return;
      }
    }

    // Check sliding window rate limit
    if (rule.maxCountPerWindow > 0 && rule.aggregationWindowMs > 0) {
      const result = await this.rateLimiter.checkAndIncrement(
        ruleId,
        event.type,
        rule.aggregationWindowMs,
        rule.maxCountPerWindow,
      );
      if (result.suppressed) {
        await this.recordModel.create({
          ruleId,
          ruleName,
          eventType: event.type,
          severity: event.severity,
          channelType: rule.channelType,
          status: NotificationDispatchStatus.SUPPRESSED,
          attemptCount: 0,
          eventPayload: event.payload,
          suppressedCount: 1,
        });
        return;
      }
    }

    // Enqueue for async dispatch
    const jobData: NotificationJobData = {
      event,
      ruleId,
      ruleName,
      channelType: rule.channelType as NotificationChannelType,
      channelConfig: rule.channelConfig,
      recipients: rule.recipients,
    };

    await this.notificationQueue.add('dispatch', jobData, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { age: 3600 },
      removeOnFail: { age: 86400 },
    });
  }

  // --- CRUD for notification rules ---

  async createRule(dto: Partial<NotificationRule>): Promise<NotificationRuleDocument> {
    this.validateRuleInput(dto);
    const validation = validateChannelConfig(
      dto.channelType as string,
      dto.channelConfig ?? {},
    );
    if (!validation.valid) {
      throw new Error(`Invalid channel config: ${validation.errors.join(', ')}`);
    }
    return this.ruleModel.create(dto);
  }

  async updateRule(
    id: string,
    dto: Partial<NotificationRule>,
  ): Promise<NotificationRuleDocument | null> {
    this.validateRuleInput(dto);
    const existing = await this.ruleModel.findById(id).lean().exec();
    if (!existing) return null;
    const channelType = (dto.channelType ?? existing.channelType) as string;
    const channelConfig = { ...(channelType === existing.channelType ? existing.channelConfig : {}), ...dto.channelConfig };
    for (const field of ['smtpPass', 'webhookUrl']) if (!dto.channelConfig?.[field] && channelType === existing.channelType) channelConfig[field] = existing.channelConfig?.[field];
    const validation = validateChannelConfig(channelType, channelConfig);
    if (!validation.valid) throw new Error(`Invalid channel config: ${validation.errors.join(', ')}`);
    dto = { ...dto, channelConfig };
    return this.ruleModel
      .findByIdAndUpdate(id, { $set: dto }, { new: true })
      .exec();
  }

  private validateRuleInput(dto: Partial<NotificationRule>) {
    const allowed = ['name', 'enabled', 'eventTypes', 'severities', 'channelType', 'channelConfig', 'recipients', 'cooldownMs', 'maxCountPerWindow', 'aggregationWindowMs'];
    if (Object.keys(dto).some(k => !allowed.includes(k))) throw new BadRequestException('包含不允许修改的通知字段');
    for (const field of ['cooldownMs', 'maxCountPerWindow', 'aggregationWindowMs'] as const) if (dto[field] !== undefined && (!Number.isSafeInteger(dto[field]) || dto[field] < 0 || dto[field] > 2147483647)) throw new BadRequestException(`${field} 必须为非负整数`);
    if (dto.enabled !== undefined && typeof dto.enabled !== 'boolean') throw new BadRequestException('enabled 必须为布尔值');
    if (dto.eventTypes && (!Array.isArray(dto.eventTypes) || dto.eventTypes.some(v => !Object.values(SystemEventType).includes(v as SystemEventType)))) throw new BadRequestException('通知事件类型无效');
    if (dto.severities && (!Array.isArray(dto.severities) || dto.severities.some(v => !Object.values(EventSeverity).includes(v as EventSeverity)))) throw new BadRequestException('通知级别无效');
    if (dto.recipients && (!Array.isArray(dto.recipients) || dto.recipients.some(v => typeof v !== 'string'))) throw new BadRequestException('接收者必须为文本数组');
  }

  async testRule(id: string) {
    const rule = await this.ruleModel.findById(id).lean().exec();
    if (!rule) throw new NotFoundException('通知规则不存在');
    const testId = randomUUID();
    const event: SystemEvent = { type: SystemEventType.PROVIDER_ERROR, severity: EventSeverity.INFO, timestamp: new Date(), source: 'admin_notification_test', payload: { test: true, testId, message: '管理员手动测试通知渠道', ruleName: rule.name } };
    const job = await this.notificationQueue.add('dispatch', { event, ruleId: id, ruleName: rule.name, channelType: rule.channelType, channelConfig: rule.channelConfig, recipients: rule.recipients }, { attempts: 1, removeOnComplete: { age: 3600 }, removeOnFail: { age: 86400 } });
    return { testId, jobId: String(job.id), queued: true };
  }

  async deleteRule(id: string): Promise<void> {
    await this.ruleModel.findByIdAndDelete(id).exec();
  }

  async listRules(filters?: { enabled?: boolean; channelType?: string }): Promise<NotificationRuleDocument[]> {
    const query: FilterQuery<NotificationRuleDocument> = {};
    if (filters?.enabled !== undefined) query.enabled = filters.enabled;
    if (filters?.channelType) query.channelType = filters.channelType;
    return this.ruleModel.find(query).sort({ createdAt: -1 }).exec();
  }

  async getRuleById(id: string): Promise<NotificationRuleDocument | null> {
    return this.ruleModel.findById(id).exec();
  }

  // --- Query notification records ---

  async listRecords(
    filters: RecordFilters,
    page = 1,
    pageSize = 20,
  ): Promise<PaginatedResult<NotificationRecordDocument>> {
    const query: FilterQuery<NotificationRecordDocument> = {};
    if (filters.eventType) query.eventType = filters.eventType;
    if (filters.channelType) query.channelType = filters.channelType;
    if (filters.status) query.status = filters.status;
    if (filters.startTime || filters.endTime) {
      query.createdAt = {};
      if (filters.startTime) query.createdAt.$gte = filters.startTime;
      if (filters.endTime) query.createdAt.$lte = filters.endTime;
    }

    const skip = (page - 1) * pageSize;
    const [items, total] = await Promise.all([
      this.recordModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .exec(),
      this.recordModel.countDocuments(query).exec(),
    ]);

    return { items, total, page, pageSize };
  }
}
