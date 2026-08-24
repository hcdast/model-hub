import portalApi from './auth-api';

import { ParamDefinition, ModelParamDoc } from '../types/model-params';

export interface ModelConfigItem {
  model_id: string;
  model_type: string;
  model_name?: string;
  provider?: string;
  disabled?: boolean;
  params?: Record<string, ParamDefinition>;
  sort?: number;
}

export const modelApi = {
  list: (params?: { types?: string; provider?: string }) =>
    portalApi.get('/models', { params }) as unknown as Promise<{ code: number; data: { items: ModelConfigItem[]; total: number } }>,

  getByName: (modelId: string) =>
    portalApi.get('/models/by-name', { params: { model_id: modelId } }) as unknown as Promise<{ code: number; data: ModelConfigItem }>,

  getParamsDoc: (params: { model_id?: string; model_type?: string }) =>
    portalApi.get('/models/params-doc', { params }) as unknown as Promise<{
      code: number;
      data: { items: ModelParamDoc[]; total: number };
    }>,
};

export default portalApi;
