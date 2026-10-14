import { useCallback, useEffect, useState } from 'react';
import { ModelParamDoc } from '../types/model-params';
import { fetchModelParamsDoc } from '../services/model-cache';

export function useModelParams(modelId?: string) {
  const [state, setState] = useState<{ id?: string; doc: ModelParamDoc | null; loading: boolean; error?: string }>({ doc: null, loading: false });
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    let active = true;
    setState({ id: modelId, doc: null, loading: !!modelId });
    if (!modelId) return;
    fetchModelParamsDoc(modelId)
      .then((doc) => { if (active) setState({ id: modelId, doc, loading: false }); })
      .catch((error) => { if (active) setState({ id: modelId, doc: null, loading: false, error: error instanceof Error ? error.message : '模型参数加载失败' }); });
    return () => { active = false; };
  }, [modelId, revision]);
  const doc = state.id === modelId ? state.doc : null;
  return { doc, params: doc?.params ?? [], loading: !!modelId && (state.id !== modelId || state.loading), error: state.id === modelId ? state.error : undefined, retry };
}
