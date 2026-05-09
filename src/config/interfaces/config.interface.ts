export interface AppConfig {
  mongodb: {
    uri: string;
    maxPoolSize?: number;
  };
  redis: {
    host: string;
    port: number;
    password?: string;
    db?: number;
  };
  auth: {
    apiKeyHeader?: string;
    serviceToken: string;
    /** 为 true 时仅接受 `api_clients` 注册的 `clientId.secret` 形式 X-API-Key */
    requireRegisteredApiKey?: boolean;
  };
  callback: {
    defaultSecret: string;
    timeoutMs: number;
    maxRetries: number;
  };
  polling: {
    cron: string;
    lockTtlMs: number;
    batchSize: number;
    defaultIntervalMs: number;
    maxIntervalMs: number;
    maxPollCount: number;
    maxDurationMs: number;
  };
  admin: {
    jwtSecret: string;
    jwtExpiresIn: string;
    defaultUsername: string;
    defaultPassword: string;
  };
  log: {
    level: string;
  };
  notification?: {
    enabled: boolean;
    queue: {
      concurrency: number;
      maxRetries: number;
    };
    defaultCooldownMs: number;
    queueBacklogThreshold: number;
    smtp?: {
      host: string;
      port: number;
      secure: boolean;
      user: string;
      pass: string;
      from: string;
    };
  };
  /** 计费模块配置（可选，向后兼容） */
  billing?: {
    /** 定价缓存 TTL（毫秒），默认 60000 */
    pricingCacheTtlMs?: number;
    /**
     * credit → USD 折算系数（用于任务详情展示）。
     * 当模型未配置 unit_usd_map / vendor_unit_usd_map 时：USD ≈ credit × creditToUsd。
     */
    creditToUsd?: number;
    /** 钱包相关配置 */
    wallet?: {
      /** 低余额告警阈值，余额低于此值时触发 wallet.low_balance 事件 */
      lowBalanceThreshold?: number;
    };
  };
}
