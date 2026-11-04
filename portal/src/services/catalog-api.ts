import axios from 'axios';
import type { ParamDocItem } from '../types/model-params';
import type { ModelContract, PublicModelPricing } from '../../../src/common/interfaces/model-contract.interface';

export interface CatalogModel {
  config_id?: string;
  model_id: string;
  model_type: string;
  model_name: string;
  provider: string;
  description: string;
  tags: string[];
}
export interface CatalogModelDoc extends CatalogModel, Omit<ModelContract, 'params'> {
  params: ParamDocItem[]; config_id?: string; revision?: number; contract_version?: number;
  public_pricing?: PublicModelPricing;
}
interface Envelope<T> { code: number; message?: string; data: T }

// Public read-only metadata never needs tokens or the session-refresh interceptor.
const catalogClient = axios.create({ baseURL: '/api/v1/catalog/models', timeout: 15000 });
async function unwrap<T>(request: Promise<{ data: Envelope<T> }>): Promise<T> {
  const { data } = await request;
  if (data.code !== 0) throw new Error(data.message || 'Catalog request failed');
  return data.data;
}
export const catalogApi = {
  list: (signal?: AbortSignal) => unwrap(catalogClient.get<Envelope<{ items: CatalogModel[]; total: number }>>('', { signal })),
  detail: (modelId: string, modelType: string | null, signal?: AbortSignal, provider?: string | null, configId?: string | null) =>
    unwrap(catalogClient.get<Envelope<CatalogModelDoc>>('/detail', { params: { model_id: modelId, ...(modelType ? { model_type: modelType } : {}), ...(provider ? { provider } : {}), ...(configId ? { config_id: configId } : {}) }, signal })),
};

export function modelDocKey(model: Pick<CatalogModel, 'model_id' | 'model_type' | 'provider' | 'config_id'>): string {
  return model.config_id || JSON.stringify([model.model_id, model.model_type, model.provider]);
}
export function modelDocPath(model: Pick<CatalogModel, 'model_id' | 'model_type' | 'provider' | 'config_id'>): string {
  return `/models/${encodeURIComponent(model.model_id)}?type=${encodeURIComponent(model.model_type)}&provider=${encodeURIComponent(model.provider)}${model.config_id ? `&config=${encodeURIComponent(model.config_id)}` : ''}`;
}
