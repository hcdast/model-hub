import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ModelConfig,
  ModelConfigDocument,
} from '../database/schemas/model-config.schema';
import { APP_CONFIG } from '../config/config.module';
import { AppConfig } from '../config/interfaces/config.interface';
import { UsageType, PriceEstimate } from './interfaces/billing.interface';

/** 缓存条目结构 */
interface PriceCacheEntry {
  /** 单价 */
  unitPrice: number;
  /** 用量类型 */
  usageType: UsageType;
  /** 货币单位 */
  currency: string;
  /** 模型默认 duration_step（视频类型使用） */
  durationStep: number;
  /** 缓存过期时间戳 */
  expireAt: number;
}

/**
 * 定价服务 —— 负责从 model_configs 集合查询模型单价并缓存。
 *
 * - 支持三种用量类型：token / count / duration
 * - 内存缓存 + TTL，减少 MongoDB 查询
 * - 模型无定价配置时返回零价格 + warning 日志
 */
@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  /** 内存定价缓存：key = model 名称 */
  private readonly cache = new Map<string, PriceCacheEntry>();

  constructor(
    @InjectModel(ModelConfig.name)
    private readonly modelConfigModel: Model<ModelConfigDocument>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * 获取模型单价信息
   *
   * 1. 先查内存缓存，命中且未过期则直接返回
   * 2. 未命中则查询 model_configs 集合
   * 3. 根据 model_type 推断 usageType
   * 4. 模型无定价配置时返回零价格 + warning 日志
   */
  async getUnitPrice(
    model: string,
  ): Promise<{ unitPrice: number; usageType: UsageType; currency: string; durationStep: number }> {
    // 查内存缓存
    const cached = this.cache.get(model);
    if (cached && cached.expireAt > Date.now()) {
      return {
        unitPrice: cached.unitPrice,
        usageType: cached.usageType,
        currency: cached.currency,
        durationStep: cached.durationStep,
      };
    }

    // 缓存未命中或已过期，查询数据库
    const modelConfig = await this.modelConfigModel
      .findOne({ model_name: model })
      .select('model_type unit_price_map unit_credit_map duration_step')
      .lean()
      .exec();

    if (!modelConfig) {
      this.logger.warn(`模型 [${model}] 无定价配置，返回零价格`);
      return { unitPrice: 0, usageType: UsageType.TOKEN, currency: 'credit', durationStep: 5 };
    }

    // 根据 model_type 推断 usageType
    const usageType = this.inferUsageType(modelConfig.model_type);

    // 从 unit_price_map 或 unit_credit_map 中提取单价
    const unitPrice = this.extractUnitPrice(
      modelConfig.unit_price_map,
      modelConfig.unit_credit_map,
    );

    const durationStep = modelConfig.duration_step ?? 5;
    const currency = 'credit';

    // 写入缓存
    const ttl = this.config.billing?.pricingCacheTtlMs ?? 60000;
    const entry: PriceCacheEntry = {
      unitPrice,
      usageType,
      currency,
      durationStep,
      expireAt: Date.now() + ttl,
    };
    this.cache.set(model, entry);

    return { unitPrice, usageType, currency, durationStep };
  }

  /**
   * 费用预估 —— 根据模型单价和输入参数预估费用
   *
   * - count 类型：estimatedUsage = input.batch_quantity 或 1
   * - duration 类型：estimatedUsage = input.duration 或模型默认 duration_step
   * - token 类型：estimatedUsage = input.max_tokens 或 1000（预估值）
   */
  async estimate(
    model: string,
    input: Record<string, any>,
  ): Promise<PriceEstimate> {
    const { unitPrice, usageType, currency, durationStep } =
      await this.getUnitPrice(model);

    let estimatedUsage: number;

    switch (usageType) {
      case UsageType.COUNT:
        estimatedUsage = input?.batch_quantity ?? 1;
        break;
      case UsageType.DURATION:
        estimatedUsage = input?.duration ?? durationStep;
        break;
      case UsageType.TOKEN:
      default:
        estimatedUsage = input?.max_tokens ?? 1000;
        break;
    }

    const estimatedCost = unitPrice * estimatedUsage;

    return {
      model,
      usageType,
      unitPrice,
      estimatedUsage,
      estimatedCost,
      currency,
    };
  }

  /** 清空内存缓存 */
  refreshCache(): void {
    this.cache.clear();
    this.logger.log('定价缓存已清空');
  }

  /**
   * 根据 model_type 推断用量类型
   * - model_type=1（图像）→ count
   * - model_type=2（视频）→ duration
   * - 其他 → token
   */
  private inferUsageType(modelType: number): UsageType {
    switch (modelType) {
      case 1:
        return UsageType.COUNT;
      case 2:
        return UsageType.DURATION;
      default:
        return UsageType.TOKEN;
    }
  }

  /**
   * 从 unit_price_map 或 unit_credit_map 中提取单价
   *
   * 优先使用 unit_price_map 中的 default 值，
   * 其次使用 unit_credit_map 中的 default 值，
   * 最后取 map 中第一个数值类型的值。
   */
  private extractUnitPrice(
    unitPriceMap?: Record<string, any>,
    unitCreditMap?: Record<string, any>,
  ): number {
    // 优先从 unit_price_map 提取
    const priceFromMap = this.extractFromMap(unitPriceMap);
    if (priceFromMap > 0) return priceFromMap;

    // 其次从 unit_credit_map 提取
    const priceFromCredit = this.extractFromMap(unitCreditMap);
    if (priceFromCredit > 0) return priceFromCredit;

    return 0;
  }

  /**
   * 从 map 中提取单价值
   * 优先取 default 键，否则取第一个数值类型的值
   */
  private extractFromMap(map?: Record<string, any>): number {
    if (!map || typeof map !== 'object') return 0;

    // 优先取 default 键
    if (map.default !== undefined && typeof map.default === 'number') {
      return map.default;
    }

    // 取第一个数值类型的值
    for (const value of Object.values(map)) {
      if (typeof value === 'number' && value > 0) {
        return value;
      }
    }

    return 0;
  }
}
