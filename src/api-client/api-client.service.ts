import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { ulid } from 'ulid';
import { ApiClient, ApiClientDocument } from '../database/schemas/api-client.schema';

const BCRYPT_ROUNDS = 10;
const SECRET_MIN_LEN = 16;

/** 列表接口返回的单行（不含 secretHash） */
export type ApiClientListRow = {
  apiKey: string;
  name?: string;
  enabled: boolean;
  defaultPriority?: number;
  billingPolicy: string;
  rateLimits?: Record<string, unknown>;
  modelAllowlist?: string[];
  createdAt?: Date;
  updatedAt?: Date;
  /** true：调用凭据即 apiKey 本身，不支持轮换 */
  plainCredentialOnly: boolean;
};

@Injectable()
export class ApiClientService {
  constructor(
    @InjectModel(ApiClient.name) private readonly apiClientModel: Model<ApiClientDocument>,
  ) {}

  /**
   * 解析旧版复合密钥 `publicKey.secret`（仅第一个 `.` 为分隔符）。
   * publicKey 与库中 api_clients.apiKey 一致。
   */
  parseCompoundCredential(raw: string): { publicApiKey: string; secret: string } | null {
    const trimmed = raw.trim();
    const dot = trimmed.indexOf('.');
    if (dot <= 0 || dot === trimmed.length - 1) return null;
    const publicApiKey = trimmed.slice(0, dot).trim();
    const secret = trimmed.slice(dot + 1);
    if (!publicApiKey.startsWith('mh_') || secret.length < SECRET_MIN_LEN) return null;
    return { publicApiKey, secret };
  }

  async validatePresentedKey(raw: string): Promise<ApiClientDocument | null> {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    const parsed = this.parseCompoundCredential(trimmed);
    if (parsed) {
      const doc = await this.apiClientModel.findOne({ apiKey: parsed.publicApiKey, enabled: true }).exec();
      if (!doc) return null;
      const ok = await bcrypt.compare(parsed.secret, doc.secretHash);
      if (!ok) return null;
      return doc;
    }

    if (!/^mh_[0-9A-Za-z_-]+$/.test(trimmed)) return null;
    const doc = await this.apiClientModel.findOne({ apiKey: trimmed, enabled: true }).exec();
    if (!doc) return null;
    const ok = await bcrypt.compare(trimmed, doc.secretHash);
    if (!ok) return null;
    return doc;
  }

  async createClient(
    name?: string,
    billingPolicy?: string,
    defaultPriority?: number,
    rateLimits?: { maxQps?: number; maxConcurrent?: number; maxDailyRequests?: number },
    modelAllowlist?: string[],
  ): Promise<{ apiKey: string; plainKey: string; name?: string; billingPolicy: string }> {
    const validPolicies = ['internal', 'external', 'exempt'];
    const policy = billingPolicy && validPolicies.includes(billingPolicy) ? billingPolicy : 'internal';

    const apiKey = `mh_${ulid()}`;
    const plainKey = apiKey;
    const secretHash = await bcrypt.hash(apiKey, BCRYPT_ROUNDS);

    const doc: Record<string, any> = {
      apiKey,
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
    return { apiKey, plainKey, name: name?.trim() || undefined, billingPolicy: policy };
  }

  async list(
    page: number,
    pageSize: number,
  ): Promise<{ items: ApiClientListRow[]; total: number; page: number; pageSize: number }> {
    const p = Math.max(1, page);
    const ps = Math.min(100, Math.max(1, pageSize));
    const [rows, total] = await Promise.all([
      this.apiClientModel
        .find()
        .select(
          // clientId：未跑迁移的旧库字段，列表需兼容合并为 apiKey 展示
          'apiKey clientId name enabled defaultPriority billingPolicy rateLimits modelAllowlist createdAt updatedAt secretHash',
        )
        .sort({ createdAt: -1 })
        .skip((p - 1) * ps)
        .limit(ps)
        .lean(),
      this.apiClientModel.countDocuments(),
    ]);
    const items: ApiClientListRow[] = rows.map((row: Record<string, unknown>) => {
      const { secretHash, clientId, ...rest } = row;
      const key = String((rest.apiKey ?? clientId) ?? '').trim();
      return {
        ...(rest as Omit<ApiClientListRow, 'plainCredentialOnly'>),
        apiKey: key,
        plainCredentialOnly: key.length > 0 && bcrypt.compareSync(key, String(secretHash)),
      };
    });
    return { items, total, page: p, pageSize: ps };
  }

  async setEnabled(apiKey: string, enabled: boolean): Promise<void> {
    const res = await this.apiClientModel.updateOne({ apiKey }, { $set: { enabled } });
    if (res.matchedCount === 0) throw new NotFoundException(`Api client not found: ${apiKey}`);
  }

  async rotateSecret(apiKey: string): Promise<{ plainKey: string }> {
    const doc = await this.apiClientModel.findOne({ apiKey }).exec();
    if (!doc) throw new NotFoundException(`Api client not found: ${apiKey}`);
    if (await bcrypt.compare(apiKey, doc.secretHash)) {
      throw new BadRequestException(
        '当前客户端调用密钥与 apiKey 相同，无法轮换。如需更换凭据请新建客户端。',
      );
    }
    const secret = randomBytes(24).toString('base64url');
    const plainKey = `${apiKey}.${secret}`;
    const secretHash = await bcrypt.hash(secret, BCRYPT_ROUNDS);
    await this.apiClientModel.updateOne({ apiKey }, { $set: { secretHash } });
    return { plainKey };
  }

  async updateDefaultPriority(apiKey: string, defaultPriority: number): Promise<void> {
    if (!Number.isInteger(defaultPriority) || defaultPriority < 0 || defaultPriority > 100) {
      throw new BadRequestException('defaultPriority must be an integer between 0 and 100');
    }
    const res = await this.apiClientModel.updateOne({ apiKey }, { $set: { defaultPriority } });
    if (res.matchedCount === 0) throw new NotFoundException(`Api client not found: ${apiKey}`);
  }

  async getDefaultPriority(apiKey: string): Promise<number> {
    const doc = await this.apiClientModel.findOne({ apiKey }).select('defaultPriority').lean();
    if (!doc) throw new NotFoundException(`Api client not found: ${apiKey}`);
    return doc.defaultPriority ?? 50;
  }

  async updateBillingPolicy(apiKey: string, billingPolicy: string): Promise<void> {
    const validPolicies = ['internal', 'external', 'exempt'];
    if (!validPolicies.includes(billingPolicy)) {
      throw new BadRequestException(`billingPolicy must be one of: ${validPolicies.join(', ')}`);
    }
    const res = await this.apiClientModel.updateOne({ apiKey }, { $set: { billingPolicy } });
    if (res.matchedCount === 0) throw new NotFoundException(`Api client not found: ${apiKey}`);
  }

  async updateRateLimits(
    apiKey: string,
    rateLimits: { maxQps?: number; maxConcurrent?: number; maxDailyRequests?: number },
  ): Promise<void> {
    const updateFields: Record<string, number> = {};
    if (rateLimits.maxQps !== undefined) updateFields['rateLimits.maxQps'] = rateLimits.maxQps;
    if (rateLimits.maxConcurrent !== undefined) updateFields['rateLimits.maxConcurrent'] = rateLimits.maxConcurrent;
    if (rateLimits.maxDailyRequests !== undefined) updateFields['rateLimits.maxDailyRequests'] = rateLimits.maxDailyRequests;

    if (Object.keys(updateFields).length === 0) {
      throw new BadRequestException('至少需要提供一个限流参数');
    }

    const res = await this.apiClientModel.updateOne({ apiKey }, { $set: updateFields });
    if (res.matchedCount === 0) throw new NotFoundException(`Api client not found: ${apiKey}`);
  }

  async updateModelAllowlist(apiKey: string, modelAllowlist: string[]): Promise<void> {
    const res = await this.apiClientModel.updateOne({ apiKey }, { $set: { modelAllowlist } });
    if (res.matchedCount === 0) throw new NotFoundException(`Api client not found: ${apiKey}`);
  }

  assertApiKeyParam(apiKey: string): void {
    if (!/^mh_[0-9A-Za-z_-]+$/.test(apiKey)) {
      throw new BadRequestException('Invalid apiKey');
    }
  }
}
