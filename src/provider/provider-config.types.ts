import { RateLimitConfig } from './interfaces/provider-adapter.interface';

/** 轮询侧限流；未配置时由 ProviderConfigService 回退为与 submit 相同或仅 QPS */
export interface PollLimitConfig {
  maxPerSecond: number;
  maxConcurrent?: number;
}

/** 合并 DB + 文件后的运行时配置（内存快照） */
export interface ResolvedProviderRuntime {
  providerName: string;
  baseUrl: string;
  // 已移除: apiKey — 密钥统一收敛到 account_pool_entries
  // 已移除: bizId — 移入 account_pool_entries.extra_credentials
  limits: RateLimitConfig;
  pollLimits: PollLimitConfig;
  enabled: boolean;
  /** 当前快照：Mongo 文档覆盖，或仅代码内默认值 */
  source: 'db' | 'defaults';
  /** 非密钥扩展字段（如 region 等），密钥相关字段请使用 ResolvedAccountCredentials */
  extra?: Record<string, unknown>;
}
