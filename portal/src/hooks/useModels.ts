import { useEffect, useState } from 'react';
import { modelApi, ModelConfigItem } from '../services/model-api';
import { NodeType } from '../types/node-types';
import { getModelTypeForNode, nodeTypeSupportsModel } from '../utils/model-type-map';

const cache = new Map<string, ModelConfigItem[]>();

export function useModels(nodeType?: NodeType) {
  const [models, setModels] = useState<ModelConfigItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!nodeType || !nodeTypeSupportsModel(nodeType)) {
      setModels([]);
      return;
    }

    const modelType = getModelTypeForNode(nodeType)!;
    const cached = cache.get(modelType);
    if (cached) {
      setModels(cached);
      return;
    }

    setLoading(true);
    modelApi
      .list({ types: modelType })
      .then((res) => {
        const items = res.data?.items || [];
        cache.set(modelType, items);
        setModels(items);
      })
      .catch(() => setModels([]))
      .finally(() => setLoading(false));
  }, [nodeType]);

  return { models, loading };
}

export function clearModelsCache() {
  cache.clear();
}
