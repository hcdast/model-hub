import axios, { AxiosHeaders, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { ProviderConfigService } from './provider-config.service';
import { ResolvedProviderRuntime } from './provider-config.types';
import { AccountPoolService, RequestResult } from './account-pool/account-pool.service';

/** Extended config to carry account pool metadata through interceptors */
interface AxiosConfigWithPoolMeta extends InternalAxiosRequestConfig {
  __accountPoolId?: string;
  __accountPoolProvider?: string;
  __accountPoolStartMs?: number;
}

/**
 * 运行时从 ProviderConfigService 读取 baseUrl / apiKey（及可选自定义头），避免 Adapter 构造时写死。
 * 当提供 accountPoolService 且该 provider 配置了账号池时，从池中选取账号注入请求。
 */
export function createRuntimeConfiguredAxios(
  providerConfig: ProviderConfigService,
  providerName: string,
  options: { timeout: number },
  customize?: (
    config: InternalAxiosRequestConfig,
    resolved: ResolvedProviderRuntime,
  ) => void,
  accountPoolService?: AccountPoolService,
): AxiosInstance {
  const client = axios.create({
    timeout: options.timeout,
    headers: { 'Content-Type': 'application/json' },
  });

  // ─── Request Interceptor ────────────────────────────────────────
  client.interceptors.request.use(async (config: AxiosConfigWithPoolMeta) => {
    // Account pool branch: when pool is configured, select an account from it
    if (accountPoolService?.hasPool(providerName)) {
      const account = await accountPoolService.selectAccount(providerName);
      if (account) {
        const accountId = (account as any)._id?.toString?.() ?? '';
        config.baseURL = account.base_url || providerConfig.getResolvedSync(providerName).baseUrl || '';
        const headers = AxiosHeaders.from(config.headers ?? {});
        headers.set('Authorization', `Bearer ${account.api_key || ''}`);
        config.headers = headers;

        // Stash metadata for response/error interceptors
        config.__accountPoolId = accountId;
        config.__accountPoolProvider = providerName;
        config.__accountPoolStartMs = Date.now();

        // Still allow adapter-level customization
        const r = providerConfig.getResolvedSync(providerName);
        customize?.(config, r);
        return config;
      }
      // No account available from pool — fall through to single-account logic
    }

    // Original single-account logic
    const r = providerConfig.getResolvedSync(providerName);
    config.baseURL = r.baseUrl || '';
    const headers = AxiosHeaders.from(config.headers ?? {});
    headers.set('Authorization', `Bearer ${r.apiKey || ''}`);
    config.headers = headers;
    customize?.(config, r);
    return config;
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
