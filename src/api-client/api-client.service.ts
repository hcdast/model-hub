import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { ulid } from 'ulid';
import { ApiClient, ApiClientDocument } from '../database/schemas/api-client.schema';

const BCRYPT_ROUNDS = 10;
const SECRET_MIN_LEN = 16;

@Injectable()
export class ApiClientService {
  constructor(
    @InjectModel(ApiClient.name) private readonly apiClientModel: Model<ApiClientDocument>,
  ) {}

  /** 解析 `clientId.secret`（仅第一个 `.` 为分隔符） */
  parsePresentedKey(raw: string): { clientId: string; secret: string } | null {
    const trimmed = raw.trim();
    const dot = trimmed.indexOf('.');
    if (dot <= 0 || dot === trimmed.length - 1) return null;
    const clientId = trimmed.slice(0, dot).trim();
    const secret = trimmed.slice(dot + 1);
    if (!clientId.startsWith('mh_') || secret.length < SECRET_MIN_LEN) return null;
    return { clientId, secret };
  }

  async validatePresentedKey(raw: string): Promise<ApiClientDocument | null> {
    const parsed = this.parsePresentedKey(raw);
    if (!parsed) return null;
    const doc = await this.apiClientModel.findOne({ clientId: parsed.clientId, enabled: true }).exec();
    if (!doc) return null;
    const ok = await bcrypt.compare(parsed.secret, doc.secretHash);
    if (!ok) return null;
    return doc;
  }

  async createClient(
    name?: string,
    billingPolicy?: string,
    defaultPriority?: number,
    rateLimits?: { maxQps?: number; maxConcurrent?: number; maxDailyRequests?: number },
    modelAllowlist?: string[],
  ): Promise<{ clientId: string; plainKey: string; name?: string; billingPolicy: string }> {
    /** 校验 billingPolicy 合法性，不合法则使用默认值 */
    const validPolicies = ['internal', 'external', 'exempt'];
    const policy = billingPolicy && validPolicies.includes(billingPolicy) ? billingPolicy : 'internal';

    const clientId = `mh_${ulid()}`;
    const secret = randomBytes(24).toString('base64url');
    const plainKey = `${clientId}.${secret}`;
    const secretHash = await bcrypt.hash(secret, BCRYPT_ROUNDS);

    const doc: Record<string, any> = {
      clientId,
      secretHash,
      name: name?.trim() || undefined,
      enabled: true,
      billingPolicy: policy,
    };

    if (defaultPriority !== undefined && Number.isInteger(defaultPriority) && defaultPriority >= 0 && defaultPriority <= 100) {
      doc.defaultPriority = defaultPriority;
    }

    if (rateLimits) {
      doc.rateLimits = {};
      if (rateLimits.maxQps !== undefined) doc.rateLimits.maxQps = rateLimits.maxQps;
      if (rateLimits.maxConcurrent !== undefined) doc.rateLimits.maxConcurrent = rateLimits.maxConcurrent;
      if (rateLimits.maxDailyRequests !== undefined) doc.rateLimits.maxDailyRequests = rateLimits.maxDailyRequests;
    }

    if (modelAllowlist && Array.isArray(modelAllowlist)) {
      doc.modelAllowlist = modelAllowlist;
    }

    await this.apiClientModel.create(doc);
    return { clientId, plainKey, name: name?.trim() || undefined, billingPolicy: policy };
  }

  async list(page: number, pageSize: number) {
    const p = Math.max(1, page);
    const ps = Math.min(100, Math.max(1, pageSize));
    const [items, total] = await Promise.all([
      this.apiClientModel
        .find()
        .select('clientId name enabled defaultPriority billingPolicy rateLimits modelAllowlist createdAt updatedAt')
        .sort({ createdAt: -1 })
        .skip((p - 1) * ps)
        .limit(ps)
        .lean(),
      this.apiClientModel.countDocuments(),
    ]);
    return { items, total, page: p, pageSize: ps };
  }

  async setEnabled(clientId: string, enabled: boolean): Promise<void> {
    const res = await this.apiClientModel.updateOne({ clientId }, { $set: { enabled } });
    if (res.matchedCount === 0) throw new NotFoundException(`Api client not found: ${clientId}`);
  }

  async rotateSecret(clientId: string): Promise<{ plainKey: string }> {
    const doc = await this.apiClientModel.findOne({ clientId }).exec();
    if (!doc) throw new NotFoundException(`Api client not found: ${clientId}`);
    const secret = randomBytes(24).toString('base64url');
    const plainKey = `${clientId}.${secret}`;
    const secretHash = await bcrypt.hash(secret, BCRYPT_ROUNDS);
    await this.apiClientModel.updateOne({ clientId }, { $set: { secretHash } });
    return { plainKey };
  }

  async updateDefaultPriority(clientId: string, defaultPriority: number): Promise<void> {
    if (!Number.isInteger(defaultPriority) || defaultPriority < 0 || defaultPriority > 100) {
      throw new BadRequestException('defaultPriority must be an integer between 0 and 100');
    }
    const res = await this.apiClientModel.updateOne({ clientId }, { $set: { defaultPriority } });
    if (res.matchedCount === 0) throw new NotFoundException(`Api client not found: ${clientId}`);
  }

  async getDefaultPriority(clientId: string): Promise<number> {
    const doc = await this.apiClientModel.findOne({ clientId }).select('defaultPriority').lean();
    if (!doc) throw new NotFoundException(`Api client not found: ${clientId}`);
    return doc.defaultPriority ?? 50;
  }

  /** 更新 API 客户端的计费策略 */
  async updateBillingPolicy(clientId: string, billingPolicy: string): Promise<void> {
    const validPolicies = ['internal', 'external', 'exempt'];
    if (!validPolicies.includes(billingPolicy)) {
      throw new BadRequestException(`billingPolicy must be one of: ${validPolicies.join(', ')}`);
    }
    const res = await this.apiClientModel.updateOne({ clientId }, { $set: { billingPolicy } });
    if (res.matchedCount === 0) throw new NotFoundException(`Api client not found: ${clientId}`);
  }

  /** 更新 API 客户端的限流配置 */
  async updateRateLimits(
    clientId: string,
    rateLimits: { maxQps?: number; maxConcurrent?: number; maxDailyRequests?: number },
  ): Promise<void> {
    const updateFields: Record<string, number> = {};
    if (rateLimits.maxQps !== undefined) updateFields['rateLimits.maxQps'] = rateLimits.maxQps;
    if (rateLimits.maxConcurrent !== undefined) updateFields['rateLimits.maxConcurrent'] = rateLimits.maxConcurrent;
    if (rateLimits.maxDailyRequests !== undefined) updateFields['rateLimits.maxDailyRequests'] = rateLimits.maxDailyRequests;

    if (Object.keys(updateFields).length === 0) {
      throw new BadRequestException('至少需要提供一个限流参数');
    }

    const res = await this.apiClientModel.updateOne({ clientId }, { $set: updateFields });
    if (res.matchedCount === 0) throw new NotFoundException(`Api client not found: ${clientId}`);
  }

  /** 更新 API 客户端的模型白名单 */
  async updateModelAllowlist(clientId: string, modelAllowlist: string[]): Promise<void> {
    const res = await this.apiClientModel.updateOne({ clientId }, { $set: { modelAllowlist } });
    if (res.matchedCount === 0) throw new NotFoundException(`Api client not found: ${clientId}`);
  }

  assertClientIdParam(clientId: string): void {
    if (!/^mh_[0-9A-Za-z_-]+$/.test(clientId)) {
      throw new BadRequestException('Invalid clientId');
    }
  }
}
