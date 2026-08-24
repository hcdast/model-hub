import { useEffect, useState } from 'react';
import { ModelParamDoc } from '../types/model-params';
import { fetchModelParamsDoc } from '../services/model-cache';

export function useModelParams(modelId?: string) {
  const [doc, setDoc] = useState<ModelParamDoc | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!modelId) {
      setDoc(null);
      return;
    }

    setLoading(true);
    fetchModelParamsDoc(modelId)
      .then(setDoc)
      .catch(() => setDoc(null))
      .finally(() => setLoading(false));
  }, [modelId]);

  return { doc, params: doc?.params ?? [], loading };
}
