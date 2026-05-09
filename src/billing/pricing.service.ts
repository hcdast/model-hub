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
import { pickCreditReferenceUnitFromPriceMap } from './unit-price-map.util';

/** 视频类用量：请求未带 duration 时的默认预估秒数（不再来自模型配置字段） */
export const DEFAULT_DURATION_FALLBACK_SECONDS = 5;

/** 缓存条目结构 */
interface PriceCacheEntry {
  /** 单价 */
  unitPrice: number;
  /** 用量类型 */
  usageType: UsageType;
  /** 货币单位 */
  currency: string;
  /** 视频类 duration 回退秒数 */
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
      .select('model_type unit_price_map')
      .lean()
      .exec();

    if (!modelConfig) {
      this.logger.warn(`模型 [${model}] 无定价配置，返回零价格`);
      return {
        unitPrice: 0,
        usageType: UsageType.TOKEN,
        currency: 'credit',
        durationStep: DEFAULT_DURATION_FALLBACK_SECONDS,
      };
    }

    // 根据 model_type 推断 usageType
    const usageType = this.inferUsageType(modelConfig.model_type);

    const unitPrice = pickCreditReferenceUnitFromPriceMap(
      modelConfig.unit_price_map as Record<string, unknown> | undefined,
    );

    const durationStep = DEFAULT_DURATION_FALLBACK_SECONDS;
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
   * - duration 类型：estimatedUsage = input.duration 或默认秒数（DEFAULT_DURATION_FALLBACK_SECONDS）
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
   * - 40001~40099（图像生成/编辑）→ count
   * - 1500~1599（视频生成/编辑）→ duration
   * - 2100~2199（动作控制）→ count
   * - 50001（音乐）→ duration
   * - 50002（TTS）→ duration
   * - 其他（LLM 等）→ token
   */
  private inferUsageType(modelType: number): UsageType {
    // 图像类：40001(text-to-image), 40002(image-to-image), 40004(character_swap), 40005(video_upscale)
    if (modelType >= 40001 && modelType <= 40099) {
      return UsageType.COUNT;
    }
    // 视频类：1501(image-to-video), 1502(text-to-video), 1504(video-to-video), 1505, 1506(reference-to-video)
    if (modelType >= 1500 && modelType <= 1599) {
      return UsageType.DURATION;
    }
    // 动作控制类
    if (modelType >= 2100 && modelType <= 2199) {
      return UsageType.COUNT;
    }
    // 音乐/语音合成类
    if (modelType >= 50001 && modelType <= 50099) {
      return UsageType.DURATION;
    }
    // 其他（LLM 等）→ token
    return UsageType.TOKEN;
  }

}
