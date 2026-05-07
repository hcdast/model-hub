/** 管理后台与运行时共用的链接转换配置结构（snake_case JSON） */

export type LinkConversionFailurePolicy = 'fail_fast' | 'use_original';

export interface LinkConversionConfig {
  enabled: boolean;
  timeout: {
    /** 下载超时（毫秒） */
    download_ms: number;
    /** 上传超时（毫秒） */
    upload_ms: number;
    /** 整体转换超时（毫秒） */
    total_ms: number;
  };
  /** 允许的第三方域名/主机模式，支持 * 通配 */
  domain_whitelist: string[];
  resource_filters: {
    allowed_types: string[];
    max_size_bytes: {
      image: number;
      video: number;
      audio: number;
    };
  };
  storage_config: {
    bucket: string;
    path_prefix: string;
    /** 传给存储服务的 biz_type，对应 storagesvc generateSignature */
    biz_type?: string;
  };
  failure_policy: LinkConversionFailurePolicy;
  retry_config: {
    max_attempts: number;
    backoff_factor: number;
    initial_delay_ms: number;
  };
  monitoring: {
    failure_rate_threshold: number;
    alert_channels: string[];
    alert_recipients: string[];
  };
  /**
   * 存储网关（@akool-sdk/storage），与 AGI-Content-Job `stroagesvc` 对齐。
   * 在管理后台「链接转换配置」中维护；启用链接转换时 host / jwt_secret 必填。
   */
  storagesvc: {
    host: string;
    jwt_secret: string;
    /** SDK 请求超时（毫秒），默认 10000 */
    timeout_ms?: number;
    resilience?: Record<string, unknown>;
    cdn_domain_list?: string[];
    /** 以下为 JWT 声明，可选；未填时使用 model-hub 默认 */
    jwt_user_id_prefix?: string;
    jwt_issuer?: string;
    jwt_expires_in?: string;
  };
}

export const DEFAULT_LINK_CONVERSION_CONFIG: LinkConversionConfig = {
  enabled: false,
  timeout: {
    download_ms: 30_000,
    upload_ms: 60_000,
    total_ms: 120_000,
  },
  domain_whitelist: [],
  resource_filters: {
    allowed_types: ['image/*', 'video/*', 'audio/*'],
    max_size_bytes: {
      image: 100 * 1024 * 1024,
      video: 1024 * 1024 * 1024,
      audio: 500 * 1024 * 1024,
    },
  },
  storage_config: {
    bucket: 'model-hub-resources',
    path_prefix: 'third-party-converted/',
    biz_type: 'model-hub-link-conversion',
  },
  failure_policy: 'use_original',
  retry_config: {
    max_attempts: 3,
    backoff_factor: 2,
    initial_delay_ms: 1000,
  },
  monitoring: {
    failure_rate_threshold: 0.05,
    alert_channels: [],
    alert_recipients: [],
  },
  storagesvc: {
    host: '',
    jwt_secret: '',
    timeout_ms: 10_000,
  },
};

/** 配置读取缓存最大存活时间（毫秒），满足「1 分钟内生效」 */
export const LINK_CONVERSION_CONFIG_CACHE_MS = 60_000;
