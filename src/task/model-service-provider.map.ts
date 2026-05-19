/**
 * AGI / model_configs 中的 `service` 字段 → Model-Hub ProviderRegistry 中的 Adapter 名（provider）。
 * 与种子数据中出现的 service 取值一致（见 collect-model-configs / importAiModelConfigs）。
 */
const SERVICE_TO_PROVIDER: Record<string, string> = {
  wavespeed: 'wavespeed-ai',
  cloudwise: 'cloudwise',
  akool: 'akool',
  minimax: 'minimax',
  alibaba: 'alibaba',
  /** 火山豆包 / ARK，对应 SeedanceAdapter */
  bytedance: 'seedance',
  /** 腾讯 VOD Kling，AGI service 为 tencent */
  tencent: 'tencent-cloud',
};

/**
 * @returns Adapter 名，未知或未接入的 service 返回 null
 */
export function mapModelConfigServiceToProvider(service: string | undefined | null): string | null {
  if (service == null || String(service).trim() === '') return null;
  const key = String(service).trim().toLowerCase();
  return SERVICE_TO_PROVIDER[key] ?? null;
}

export function listKnownServiceKeys(): string[] {
  return Object.keys(SERVICE_TO_PROVIDER);
}

/**
 * model_id 首段不是 Adapter 名时的已知映射（如 akool-premium/headswap → akool）。
 */
const MODEL_ID_PREFIX_TO_PROVIDER: Record<string, string> = {
  'akool-premium': 'akool',
  'akool-premium-multi-person': 'akool',
};

/**
 * 无 model_configs / 路由规则时的 provider 推断。
 * 1. 首段已是注册的 Adapter 名 → 直接使用
 * 2. 已知 model_id 前缀 → 映射到 Adapter
 * 3. 首段为 AGI service 名 → mapModelConfigServiceToProvider
 */
export function inferProviderFallback(
  modelId: string,
  hasAdapter: (adapterName: string) => boolean,
): string | null {
  const trimmed = String(modelId || '').trim();
  if (!trimmed.includes('/')) return null;

  const first = trimmed.split('/')[0];
  if (hasAdapter(first)) return first;

  const fromPrefix = MODEL_ID_PREFIX_TO_PROVIDER[first.toLowerCase()];
  if (fromPrefix && hasAdapter(fromPrefix)) return fromPrefix;

  const fromService = mapModelConfigServiceToProvider(first);
  if (fromService && hasAdapter(fromService)) return fromService;

  return null;
}
