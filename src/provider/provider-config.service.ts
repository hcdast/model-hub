import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ProviderRuntimeConfig,
  ProviderRuntimeConfigDocument,
} from '../database/schemas/provider-runtime-config.schema';
import { RateLimitConfig } from './interfaces/provider-adapter.interface';
import { PollLimitConfig, ResolvedProviderRuntime } from './provider-config.types';
import { REGISTERED_PROVIDER_NAMES } from '../queue/queue.constants';

/** 无 DB 文档时的默认限流（与历史文件配置对齐） */
const DEFAULT_LIMITS: Record<string, { maxConcurrent: number; maxPerSecond: number }> = {
  'wavespeed-ai': { maxConcurrent: 10, maxPerSecond: 5 },
  cloudwise: { maxConcurrent: 200, maxPerSecond: 50 },
  akool: { maxConcurrent: 50, maxPerSecond: 20 },
  minimax: { maxConcurrent: 20, maxPerSecond: 10 },
  seedance: { maxConcurrent: 10, maxPerSecond: 5 },
  alibaba: { maxConcurrent: 20, maxPerSecond: 10 },
  'tencent-cloud': { maxConcurrent: 20, maxPerSecond: 10 },
};

const DEFAULT_BASE_URL: Record<string, string> = {
  'wavespeed-ai': 'https://api.wavespeed.ai/api/v3',
  cloudwise: 'https://api.cloudwise.ai/api',
  akool: 'http://internal-algorithm-queue.akool.com',
  minimax: 'https://api.minimax.io',
  seedance: 'https://ark.cn-beijing.volces.com/api/v3',
  alibaba: 'https://dashscope.aliyuncs.com',
  'tencent-cloud': 'https://api.cloudwise.ai/api',
};

@Injectable()
export class ProviderConfigService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProviderConfigService.name);
  private readonly snapshot = new Map<string, ResolvedProviderRuntime>();
  private refreshTimer?: NodeJS.Timeout;

  constructor(
    @InjectModel(ProviderRuntimeConfig.name)
    private readonly runtimeModel: Model<ProviderRuntimeConfigDocument>,
  ) {}

  onModuleInit() {
    void this.refreshAll();
    this.refreshTimer = setInterval(() => {
      void this.refreshAll();
    }, 15_000);
  }

  onModuleDestroy() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  /** 管理端更新后调用，清空快照并异步刷新 */
  async invalidateAndRefresh(): Promise<void> {
    this.snapshot.clear();
    await this.refreshAll();
  }

  async refreshAll(): Promise<void> {
    for (const name of REGISTERED_PROVIDER_NAMES) {
      await this.refreshOne(name);
    }
  }

  async refreshOne(providerName: string): Promise<void> {
    const defaults = this.buildDefaults(providerName);
    let resolved: ResolvedProviderRuntime = { ...defaults };
    try {
      const doc = await this.runtimeModel
        .findOne({ provider_name: providerName })
        .lean()
        .exec();
      if (doc && doc.enabled !== false) {
        resolved = this.mergeDoc(defaults, doc);
      } else {
        resolved = { ...defaults, source: 'defaults' };
      }
    } catch (err: any) {
      this.logger.warn(`refreshOne ${providerName}: ${err.message}`);
      resolved = { ...defaults, source: 'defaults' };
    }
    this.snapshot.set(providerName, resolved);
  }

  private buildDefaults(providerName: string): ResolvedProviderRuntime {
    const def = DEFAULT_LIMITS[providerName] || { maxConcurrent: 10, maxPerSecond: 5 };
    const limits: RateLimitConfig = {
      maxConcurrent: def.maxConcurrent,
      maxPerSecond: def.maxPerSecond,
    };
    return {
      providerName,
      baseUrl: DEFAULT_BASE_URL[providerName] || '',
      // 已移除: apiKey — 密钥统一收敛到 account_pool_entries
      limits,
      pollLimits: {
        maxPerSecond: def.maxPerSecond,
      },
      enabled: true,
      source: 'defaults',
    };
  }

  private mergeDoc(
    base: ResolvedProviderRuntime,
    doc: {
      base_url?: string;
      extra?: Record<string, unknown>;
      limits?: {
        max_concurrent?: number;
        max_per_second?: number;
        max_per_minute?: number;
      };
      poll_limits?: { max_per_second?: number; max_concurrent?: number };
      enabled?: boolean;
    },
  ): ResolvedProviderRuntime {
    // 已移除: 不再从 doc 读取 api_key（密钥统一收敛到 account_pool_entries）
    // 已移除: 不再从 doc.extra 提取 bizId（移入 account_pool_entries.extra_credentials）
    const limits: RateLimitConfig = {
      maxConcurrent: doc.limits?.max_concurrent ?? base.limits.maxConcurrent,
      maxPerSecond: doc.limits?.max_per_second ?? base.limits.maxPerSecond,
      maxPerMinute: doc.limits?.max_per_minute ?? base.limits.maxPerMinute,
    };
    const pollSecond =
      doc.poll_limits?.max_per_second ?? limits.maxPerSecond;
    return {
      providerName: base.providerName,
      baseUrl: doc.base_url?.trim() || base.baseUrl,
      limits,
      pollLimits: {
        maxPerSecond: pollSecond,
        maxConcurrent: doc.poll_limits?.max_concurrent,
      },
      enabled: doc.enabled !== false,
      source: 'db',
      extra: doc.extra || {},
    };
  }

  /** 同步读取；无快照时用代码默认值（未落库或未启用 DB 行） */
  getResolvedSync(providerName: string): ResolvedProviderRuntime {
    const hit = this.snapshot.get(providerName);
    if (hit) return hit;
    return this.buildDefaults(providerName);
  }

  async getResolved(providerName: string): Promise<ResolvedProviderRuntime> {
    await this.refreshOne(providerName);
    return this.getResolvedSync(providerName);
  }

  getSubmitLimitsSync(providerName: string): RateLimitConfig {
    return { ...this.getResolvedSync(providerName).limits };
  }

  getPollLimitsSync(providerName: string): PollLimitConfig {
    const r = this.getResolvedSync(providerName);
    const maxPerSecond = r.pollLimits.maxPerSecond ?? r.limits.maxPerSecond;
    return {
      maxPerSecond,
      maxConcurrent: r.pollLimits.maxConcurrent,
    };
  }
}
