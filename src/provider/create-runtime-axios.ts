import axios, { AxiosHeaders, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { Logger } from '@nestjs/common';
import { ProviderConfigService } from './provider-config.service';
import { ResolvedProviderRuntime } from './provider-config.types';
import { AccountPoolService, RequestResult } from './account-pool/account-pool.service';
import { ResolvedAccountCredentials } from './account-pool/resolved-account-credentials.interface';

const logger = new Logger('createRuntimeConfiguredAxios');

/** Extended config to carry account pool metadata through interceptors */
interface AxiosConfigWithPoolMeta extends InternalAxiosRequestConfig {
  __accountPoolId?: string;
  __accountPoolProvider?: string;
  __accountPoolStartMs?: number;
}

/**
 * 运行时从 AccountPoolService 获取密钥，从 ProviderConfigService 读取 baseUrl 等全局配置。
 * 密钥的唯一来源是 account_pool_entries，provider_runtime_configs 不再存储密钥。
 */
export function createRuntimeConfiguredAxios(
  providerConfig: ProviderConfigService,
  providerName: string,
  options: { timeout: number },
  customize?: (
    config: InternalAxiosRequestConfig,
    resolved: ResolvedProviderRuntime,
    credentials?: ResolvedAccountCredentials,
  ) => void,
  accountPoolService?: AccountPoolService,
  migrationComplete?: boolean,
): AxiosInstance {
  const client = axios.create({
    timeout: options.timeout,
    headers: { 'Content-Type': 'application/json' },
  });

  // ─── Request Interceptor ────────────────────────────────────────
  client.interceptors.request.use(async (config: AxiosConfigWithPoolMeta) => {
    const r = providerConfig.getResolvedSync(providerName);

    // 账号池分支：统一从账号池获取密钥
    if (accountPoolService?.hasPool(providerName)) {
      const account = await accountPoolService.selectAccount(providerName);
      if (account) {
        config.baseURL = account.base_url || r.baseUrl || '';
        const headers = AxiosHeaders.from(config.headers ?? {});
        headers.set('Authorization', `Bearer ${account.api_key || ''}`);
        config.headers = headers;

        // 构建 ResolvedAccountCredentials，传递给 customize 回调
        const credentials: ResolvedAccountCredentials = {
          apiKey: account.api_key,
          extraCredentials: (account as any).extra_credentials || {},
          accountId: (account as any)._id?.toString?.() ?? '',
          accountAlias: account.account_alias,
        };

        // 保存元数据供响应/错误拦截器使用
        config.__accountPoolId = credentials.accountId;
        config.__accountPoolProvider = providerName;
        config.__accountPoolStartMs = Date.now();

        // 允许 Adapter 层自定义（传递 credentials）
        customize?.(config, r, credentials);
        return config;
      }
      // 账号池中无可用账号 — 继续到降级/报错逻辑
    }

    // 无账号池分支：根据 migrationComplete 标志决定行为
    if (!migrationComplete) {
      // 过渡期：打印 deprecation 警告并降级
      logger.warn(
        `[DEPRECATED] Provider "${providerName}" has no account pool entries. ` +
        `Please run the migration script: npm run migrate:secrets. ` +
        `Falling back to provider config defaults.`,
      );
      config.baseURL = r.baseUrl || '';
      const headers = AxiosHeaders.from(config.headers ?? {});
      // 过渡期降级：不设置 Authorization（r 中已无 apiKey）
      config.headers = headers;
      customize?.(config, r);
      return config;
    }

    // 迁移完成后：无账号池直接报错
    throw new Error(
      `Provider "${providerName}" has no account pool entries configured. ` +
      `Please add at least one account in the Account Pool management page.`,
    );
  });

  // ─── Response Interceptor (success) ─────────────────────────────
  client.interceptors.response.use(
    (response) => {
      const cfg = response.config as AxiosConfigWithPoolMeta;
      if (cfg.__accountPoolId && accountPoolService) {
        const durationMs = cfg.__accountPoolStartMs
          ? Date.now() - cfg.__accountPoolStartMs
          : 0;
        const result: RequestResult = {
          success: true,
          durationMs,
        };
        // Fire-and-forget: don't block the response
        accountPoolService
          .reportResult(cfg.__accountPoolId, cfg.__accountPoolProvider || providerName, result)
          .catch(() => {});
      }
      return response;
    },
    (error) => {
      const cfg = (error?.config ?? {}) as AxiosConfigWithPoolMeta;
      if (cfg.__accountPoolId && accountPoolService) {
        const durationMs = cfg.__accountPoolStartMs
          ? Date.now() - cfg.__accountPoolStartMs
          : 0;
        const status = error?.response?.status;
        const retryable = status === 429 || (status >= 500 && status < 600);
        const result: RequestResult = {
          success: false,
          durationMs,
          errorCode: status ? `HTTP_${status}` : 'NETWORK_ERROR',
          retryable,
        };
        accountPoolService
          .reportResult(cfg.__accountPoolId, cfg.__accountPoolProvider || providerName, result)
          .catch(() => {});
      }
      return Promise.reject(error);
    },
  );

  return client;
}
