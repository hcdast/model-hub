import { modelApi, ModelConfigItem } from '../services/model-api';
import { ModelParamDoc } from '../types/model-params';

const detailCache = new Map<string, ModelConfigItem>();
const paramsCache = new Map<string, ModelParamDoc>();

export async function fetchModelDetail(modelId: string): Promise<ModelConfigItem | null> {
  const cached = detailCache.get(modelId);
  if (cached) return cached;

  try {
    const res = await modelApi.getByName(modelId);
    if (res.code !== 0 || !res.data) return null;
    detailCache.set(modelId, res.data);
    return res.data;
  } catch {
    return null;
  }
}

export async function fetchModelParamsDoc(modelId: string): Promise<ModelParamDoc | null> {
  const cached = paramsCache.get(modelId);
  if (cached) return cached;

  try {
    const res = await modelApi.getParamsDoc({ model_id: modelId });
    const doc = res.data?.items?.[0] as ModelParamDoc | undefined;
    if (doc) {
      paramsCache.set(modelId, doc);
      return doc;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearModelDetailCache() {
  detailCache.clear();
  paramsCache.clear();
}
