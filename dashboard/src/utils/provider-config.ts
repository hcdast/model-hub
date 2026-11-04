import type { ProviderConfigItem } from '../services/api';

const LLM_BASE_URL_ERROR = 'LLM Base URL 需为以 /v1 结尾的 HTTPS 地址，不含凭证、查询参数或片段，例如 https://llm-fat.akool.io/v1';

export function providerConfigForm(config: ProviderConfigItem): Record<string, any> {
  return {
    provider_name: config.provider_name,
    enabled: config.enabled,
    icon_url: config.icon_url || '',
    base_url: config.base_url || '',
    llm_base_url: typeof config.extra?.llm_base_url === 'string' ? config.extra.llm_base_url : '',
    max_concurrent: config.limits?.maxConcurrent,
    max_per_second: config.limits?.maxPerSecond,
    max_per_minute: config.limits?.maxPerMinute,
    poll_max_per_second: config.poll_limits?.max_per_second,
    poll_max_concurrent: config.poll_limits?.max_concurrent,
  };
}

/** Rebase only non-conflicting edits; never approve overwriting another editor's changes. */
export function mergeProviderConfigForm(base: Record<string, any>, draft: Record<string, any>, latest: Record<string, any>) {
  const normalize = (key: string, value: any) => {
    if (value == null) return ['icon_url', 'base_url', 'llm_base_url'].includes(key) ? '' : undefined;
    if (typeof value !== 'string') return value;
    return key === 'llm_base_url' ? value.trim().replace(/\/+$/, '') : value.trim();
  };
  const merged = { ...latest };
  const conflicts: string[] = [];
  for (const key of Object.keys(base)) {
    const original = normalize(key, base[key]);
    const local = normalize(key, draft[key]);
    const remote = normalize(key, latest[key]);
    if (local === original) continue;
    if (remote !== original && remote !== local) conflicts.push(key);
    merged[key] = draft[key];
  }
  return { values: merged, conflicts };
}

export function validateLlmBaseUrl(value?: string): void {
  const base = value?.trim();
  if (!base) return;
  try {
    const url = new URL(base);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !/\/v1\/?$/.test(url.pathname)) {
      throw new Error();
    }
  } catch {
    throw new Error(LLM_BASE_URL_ERROR);
  }
}

export function providerConfigErrorMessage(error: any, fallback: string): string {
  const detail = error?.response?.data?.message;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const messages = detail.filter((item): item is string => typeof item === 'string' && !!item.trim());
    if (messages.length) return messages.join('；');
  }
  return typeof error?.message === 'string' && error.message.trim() ? error.message : fallback;
}
