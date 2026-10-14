import { modelApi, ModelConfigItem } from './model-api';
import { ModelParamDoc } from '../types/model-params';

const detailCache = new Map<string, Promise<ModelConfigItem>>();
const paramsCache = new Map<string, Promise<ModelParamDoc>>();

export function fetchModelDetail(modelId: string): Promise<ModelConfigItem> {
  let request = detailCache.get(modelId);
  if (!request) {
    request = modelApi.getByName(modelId).then((res) => {
      if (res.code !== 0 || !res.data) throw new Error('模型详情加载失败');
      return res.data;
    }).catch((error) => { detailCache.delete(modelId); throw error; });
    detailCache.set(modelId, request);
  }
  return request;
}

export function fetchModelParamsDoc(modelId: string): Promise<ModelParamDoc> {
  let request = paramsCache.get(modelId);
  if (!request) {
    request = modelApi.getParamsDoc({ model_id: modelId }).then((res) => {
      const doc = res.data?.items?.find((item) => item.model_id === modelId);
      if (res.code !== 0 || !doc) throw new Error('模型参数定义加载失败');
      return doc;
    }).catch((error) => { paramsCache.delete(modelId); throw error; });
    paramsCache.set(modelId, request);
  }
  return request;
}

export function clearModelDetailCache() {
  detailCache.clear();
  paramsCache.clear();
}
