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
}
