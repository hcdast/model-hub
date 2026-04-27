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

  async createClient(name?: string): Promise<{ clientId: string; plainKey: string; name?: string }> {
    const clientId = `mh_${ulid()}`;
    const secret = randomBytes(24).toString('base64url');
    const plainKey = `${clientId}.${secret}`;
    const secretHash = await bcrypt.hash(secret, BCRYPT_ROUNDS);
    await this.apiClientModel.create({
      clientId,
      secretHash,
      name: name?.trim() || undefined,
      enabled: true,
    });
    return { clientId, plainKey, name: name?.trim() || undefined };
  }

  async list(page: number, pageSize: number) {
    const p = Math.max(1, page);
    const ps = Math.min(100, Math.max(1, pageSize));
    const [items, total] = await Promise.all([
      this.apiClientModel
        .find()
        .select('clientId name enabled defaultPriority createdAt updatedAt')
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

  assertClientIdParam(clientId: string): void {
    if (!/^mh_[0-9A-Za-z_-]+$/.test(clientId)) {
      throw new BadRequestException('Invalid clientId');
    }
  }
}
