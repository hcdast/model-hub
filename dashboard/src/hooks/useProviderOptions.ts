import { useCallback, useEffect, useMemo, useState } from 'react';
import { providerConfigApi, type ProviderConfigItem } from '../services/api';

let cachedItems: ProviderConfigItem[] | null = null;
let inflight: Promise<ProviderConfigItem[]> | null = null;

async function loadProviderConfigs(): Promise<ProviderConfigItem[]> {
  if (cachedItems) return cachedItems;
  if (!inflight) {
    inflight = providerConfigApi
      .list()
      .then((res: { data?: { items?: ProviderConfigItem[] } }) => {
        const items = res.data?.items ?? [];
        cachedItems = items;
        return items;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** 供应商配置变更后调用，使各页下拉选项重新拉取 */
export function invalidateProviderOptionsCache(): void {
  cachedItems = null;
}

export interface UseProviderOptionsResult {
  options: { label: string; value: string }[];
  providerNames: string[];
  items: ProviderConfigItem[];
  loading: boolean;
  refresh: () => Promise<void>;
}

/**
 * 从 provider_runtime_configs（供应商配置）加载厂商下拉选项，全站统一数据源。
 * @param extraValues 额外并入的 value（如编辑态当前 provider 尚未入库）
 */
export function useProviderOptions(extraValues?: string[]): UseProviderOptionsResult {
  const [items, setItems] = useState<ProviderConfigItem[]>(cachedItems ?? []);
  const [loading, setLoading] = useState(!cachedItems);

  const refresh = useCallback(async () => {
    invalidateProviderOptionsCache();
    setLoading(true);
    try {
      const list = await loadProviderConfigs();
      setItems(list);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (cachedItems) {
      setItems(cachedItems);
      setLoading(false);
      return;
    }
    setLoading(true);
    loadProviderConfigs()
      .then((list) => {
        if (!cancelled) setItems(list);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const providerNames = useMemo(() => {
    const base = items.map((p) => p.provider_name).filter(Boolean);
    const extras = (extraValues ?? []).map((v) => String(v).trim()).filter(Boolean);
    return [...new Set([...base, ...extras])].sort((a, b) => a.localeCompare(b));
  }, [items, extraValues]);

  const options = useMemo(
    () => providerNames.map((name) => ({ label: name, value: name })),
    [providerNames],
  );

  return { options, providerNames, items, loading, refresh };
}
