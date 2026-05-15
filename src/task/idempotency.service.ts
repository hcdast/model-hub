import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  IdempotencyRecord,
  IdempotencyRecordDocument,
} from '../database/schemas/idempotency-record.schema';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(
    @InjectModel(IdempotencyRecord.name)
    private readonly model: Model<IdempotencyRecordDocument>,
  ) {}

  async check(
    apiKey: string,
    idempotencyKey: string,
  ): Promise<string | null> {
    const existing = await this.model.findOne({ apiKey, idempotencyKey });
    if (existing) {
      this.logger.log(
        `Idempotency hit: apiKey=${apiKey}, key=${idempotencyKey}, taskId=${existing.taskId}`,
      );
      return existing.taskId;
    }
    return null;
  }

  async record(
    apiKey: string,
    idempotencyKey: string,
    taskId: string,
    ttlMs = DEFAULT_TTL_MS,
  ): Promise<void> {
    const expireAt = new Date(Date.now() + ttlMs);
    try {
      await this.model.create({ apiKey, idempotencyKey, taskId, expireAt });
    } catch (err: any) {
      if (err?.code === 11000) {
        this.logger.warn(`Idempotency duplicate insert: ${apiKey} / ${idempotencyKey}`);
        return;
      }
      throw err;
    }
  }
}
