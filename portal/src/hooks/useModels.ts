import { useCallback, useEffect, useState } from 'react';
import { modelApi, ModelConfigItem } from '../services/model-api';
import { NodeType } from '../types/node-types';
import { getModelTypeForNode, nodeTypeSupportsModel } from '../utils/model-type-map';

const cache = new Map<string, Promise<ModelConfigItem[]>>();

export function useModels(nodeType?: NodeType) {
  const [state, setState] = useState<{ key?: string; models: ModelConfigItem[]; loading: boolean; error?: string }>({ models: [], loading: false });
  const [revision, setRevision] = useState(0);
  const key = nodeType && nodeTypeSupportsModel(nodeType) ? getModelTypeForNode(nodeType) ?? '*' : undefined;
  const retry = useCallback(() => { if (key) cache.delete(key); setRevision((n) => n + 1); }, [key]);
  useEffect(() => {
    let active = true;
    if (!key) { setState({ key, models: [], loading: false }); return; }
    setState({ key, models: [], loading: true });
    let request = cache.get(key);
    if (!request) {
      request = modelApi.list(key === '*' ? undefined : { types: key }).then((res) => {
        if (res.code !== 0 || !Array.isArray(res.data?.items)) throw new Error('模型列表加载失败');
        return res.data.items;
      }).catch((error) => { cache.delete(key); throw error; });
      cache.set(key, request);
    }
    request.then((models) => { if (active) setState({ key, models, loading: false }); })
      .catch((error) => { if (active) setState({ key, models: [], loading: false, error: error instanceof Error ? error.message : '模型列表加载失败' }); });
    return () => { active = false; };
  }, [key, revision]);
  return { models: state.key === key ? state.models : [], loading: !!key && (state.key !== key || state.loading), error: state.key === key ? state.error : undefined, retry };
}

export function clearModelsCache() { cache.clear(); }
