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
