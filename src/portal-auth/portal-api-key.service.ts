/*
 * Portal API Key Service
 * 开发者门户 API Key 管理服务
 */
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ulid } from 'ulid';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import {
  PortalApiKey,
  PortalApiKeyDocument,
} from '../database/schemas/portal-api-key.schema';
import {
  PortalUser,
  PortalUserDocument,
} from '../database/schemas/portal-user.schema';
import { getRolePermissions } from './role-permissions.config';
import { WalletService } from '../billing/wallet.service';

@Injectable()
export class PortalApiKeyService {
  private readonly logger = new Logger(PortalApiKeyService.name);

  constructor(
    @InjectModel(PortalApiKey.name)
    private readonly apiKeyModel: Model<PortalApiKeyDocument>,
    @InjectModel(PortalUser.name)
    private readonly portalUserModel: Model<PortalUserDocument>,
    private readonly walletService: WalletService,
  ) {}

  /**
   * 获取用户的 API Key 列表
   */
  async listByUser(userId: string): Promise<any[]> {
    const keys = await this.apiKeyModel
      .find({
        userId,
        $or: [
          { expiresAt: { $exists: false } },
          { expiresAt: { $gt: new Date() } },
        ],
      })
      .sort({ createdAt: -1 })
      .lean();

    return keys.map((key) => ({
      id: key._id.toString(),
      name: key.name,
      apiKey: key.maskedKey,
      permissions: key.permissions,
      enabled: key.enabled,
      rateLimit: key.rateLimit,
      lastUsedAt: key.lastUsedAt,
      expiresAt: key.expiresAt,
      createdAt: key.createdAt,
    }));
  }

  /**
   * 获取用户的 API Key 限制信息
   */
  async getUserLimits(userId: string): Promise<any> {
    const user = await this.portalUserModel.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const rolePerms = getRolePermissions(user.role);
    const currentCount = await this.apiKeyModel.countDocuments({
      userId,
      $or: [
        { expiresAt: { $exists: false } },
        { expiresAt: { $gt: new Date() } },
      ],
    });

    return {
      role: user.role,
      roleDisplayName: rolePerms.displayName,
      apiKey: {
        currentCount,
        maxCount: rolePerms.apiKey.maxCount,
        canCreate: rolePerms.apiKey.maxCount === -1 || currentCount < rolePerms.apiKey.maxCount,
        defaultQps: rolePerms.apiKey.defaultQps,
        maxQps: rolePerms.apiKey.maxQps,
        defaultDailyRequests: rolePerms.apiKey.defaultDailyRequests,
        maxDailyRequests: rolePerms.apiKey.maxDailyRequests,
      },
      workflow: rolePerms.workflow,
      models: rolePerms.models,
      features: rolePerms.features,
      priority: rolePerms.priority,
    };
  }

  /**
   * 创建新的 API Key
   */
  async create(
    userId: string,
    name: string,
    expiresAt?: Date,
    customRateLimit?: { maxQps?: number; maxDailyRequests?: number },
  ): Promise<{ id: string; apiKey: string; name: string; rateLimit: unknown }> {
    const normalizedName = name.trim();
    if (!normalizedName) {
      throw new BadRequestException('API Key name is required');
    }
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('API Key expiry must be in the future');
    }
    const user = await this.portalUserModel.findById(userId);
    if (!user || user.deletedAt || user.status !== 'active') {
      throw new NotFoundException('User not found or inactive');
    }

    const rolePerms = getRolePermissions(user.role);
    await this.apiKeyModel.deleteMany({
      userId,
      expiresAt: { $lte: new Date() },
    });
    const existingKeys = await this.apiKeyModel
      .find({ userId })
      .select('slot')
      .lean();
    const maxCount = rolePerms.apiKey.maxCount;
    if (maxCount !== -1 && existingKeys.length >= maxCount) {
      throw new BadRequestException(
        `已达到 API Key 数量上限 (${maxCount})。升级到 VIP 或管理员可创建更多。`,
      );
    }
    const occupiedSlots = new Set(
      existingKeys.flatMap((key) =>
        typeof key.slot === 'number' ? [key.slot] : [],
      ),
    );
    let legacyCount = existingKeys.length - occupiedSlots.size;
    for (let slot = 0; legacyCount > 0; slot += 1) {
      if (occupiedSlots.has(slot)) continue;
      occupiedSlots.add(slot);
      legacyCount -= 1;
    }
    let slot = 0;
    while (occupiedSlots.has(slot)) slot += 1;

    const rateLimit = {
      maxQps: this.applyLimit(
        customRateLimit?.maxQps || rolePerms.apiKey.defaultQps,
        rolePerms.apiKey.maxQps,
      ),
      maxDailyRequests: this.applyLimit(
        customRateLimit?.maxDailyRequests || rolePerms.apiKey.defaultDailyRequests,
        rolePerms.apiKey.maxDailyRequests,
      ),
    };

    let key: PortalApiKeyDocument | null = null;
    let plainKey = '';
    let createdKeyId: string | null = null;
    try {
      while (!key) {
        if (maxCount !== -1 && slot >= maxCount) {
          throw new BadRequestException(
            `已达到 API Key 数量上限 (${maxCount})。升级到 VIP 或管理员可创建更多。`,
          );
        }
        const keyId = ulid();
        const secret = randomBytes(32).toString('base64url');
        plainKey = `mh_${keyId}_${secret}`;
        const secretHash = createHash('sha256').update(secret).digest('hex');
        const maskedKey = `mh_${keyId.slice(0, 6)}...${secret.slice(-4)}`;
        const billingKey = `portal:${keyId}`;
        try {
          key = await this.apiKeyModel.create({
            userId,
            slot,
            keyId,
            secretHash,
            maskedKey,
            billingKey,
            permissions: ['*'],
            enabled: true,
            modelAllowlist: rolePerms.models.allowedModels,
            billingPolicy: 'internal',
            rateLimit,
            expiresAt,
          });
        } catch (error: unknown) {
          const duplicateKey = Reflect.get(Object(error), 'code') === 11000;
          if (!duplicateKey) throw error;
          occupiedSlots.add(slot);
          while (occupiedSlots.has(slot)) slot += 1;
        }
      }
      if (!key) throw new BadRequestException('Unable to create API Key');
      createdKeyId = key._id.toString();
      await this.walletService.ensureWallet(key.billingKey);
    } catch (error) {
      if (createdKeyId) {
        await this.apiKeyModel.deleteOne({ _id: createdKeyId });
      }
      throw error;
    }

    this.logger.log(`API Key created for user ${userId} (role: ${user.role}): ${name}`);
    return {
      id: key._id.toString(),
      apiKey: plainKey,
      name: key.name,
      rateLimit,
    };
  }

  /**
   * 应用限制（不能超过上限）
   */
  private applyLimit(value: number, max: number): number {
    if (max === -1) return value;  // -1 表示无限制
    return Math.min(value, max);
  }

  /**
   * 删除 API Key
   */
  async delete(userId: string, keyId: string): Promise<void> {
    const key = await this.apiKeyModel.findOneAndDelete({ _id: keyId, userId });
    if (!key) {
      throw new NotFoundException('API Key not found');
    }

    this.logger.log(`API Key deleted for user ${userId}: ${key.name}`);
  }

  /**
   * 更新 API Key
   */
  async update(
    userId: string,
    keyId: string,
    data: { name?: string; enabled?: boolean; rateLimit?: { maxQps?: number; maxDailyRequests?: number } },
  ): Promise<any> {
    const user = await this.portalUserModel.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const key = await this.apiKeyModel.findOne({ _id: keyId, userId });
    if (!key) {
      throw new NotFoundException('API Key not found');
    }

    const rolePerms = getRolePermissions(user.role);

    if (data.name !== undefined) {
      const normalizedName = data.name.trim();
      if (!normalizedName) {
        throw new BadRequestException('API Key name is required');
      }
      key.name = normalizedName;
    }
    if (data.enabled !== undefined) key.enabled = data.enabled;

    // 更新速率限制（应用角色上限）
    if (data.rateLimit) {
      key.rateLimit = {
        maxQps: this.applyLimit(
          data.rateLimit.maxQps || key.rateLimit?.maxQps || rolePerms.apiKey.defaultQps,
          rolePerms.apiKey.maxQps,
        ),
        maxDailyRequests: this.applyLimit(
          data.rateLimit.maxDailyRequests || key.rateLimit?.maxDailyRequests || rolePerms.apiKey.defaultDailyRequests,
          rolePerms.apiKey.maxDailyRequests,
        ),
      };
    }

    await key.save();

    return {
      id: key._id.toString(),
      name: key.name,
      apiKey: key.maskedKey,
      permissions: key.permissions,
      enabled: key.enabled,
      rateLimit: key.rateLimit,
    };
  }

  /**
   * 验证 API Key
   */
  async validate(apiKey: string): Promise<PortalApiKeyDocument | null> {
    if (!apiKey.startsWith('mh_')) return null;
    const parts = apiKey.slice(3).split('_');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    const [keyId, secret] = parts;

    const key = await this.apiKeyModel
      .findOne({ keyId, enabled: true })
      .select('+secretHash');
    if (!key) return null;

    const presentedHash = createHash('sha256').update(secret).digest();
    const storedHash = Buffer.from(key.secretHash, 'hex');
    if (
      storedHash.length !== presentedHash.length ||
      !timingSafeEqual(storedHash, presentedHash)
    ) {
      return null;
    }
    if (key.expiresAt && key.expiresAt < new Date()) return null;
    const owner = await this.portalUserModel
      .findOne({ _id: key.userId, status: 'active', deletedAt: null })
      .select('_id')
      .lean();
    if (!owner) return null;

    key.lastUsedAt = new Date();
    await key.save();
    return key;
  }

  async findExecutionBillingKey(userId: string): Promise<string | null> {
    const key = await this.apiKeyModel
      .findOne({
        userId,
        enabled: true,
        $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }],
      })
      .sort({ createdAt: 1 })
      .select('billingKey')
      .lean();
    return key?.billingKey ?? null;
  }

}
