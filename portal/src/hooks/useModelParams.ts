import type { ModelSelection } from '../../../src/common/interfaces/model-contract.interface';
import { useCallback, useEffect, useState } from 'react';
import { ModelParamDoc } from '../types/model-params';
import { fetchModelParamsDoc } from '../services/model-cache';

export function useModelParams(modelId?: string, selection?: ModelSelection) {
  const [state, setState] = useState<{ id?: string; doc: ModelParamDoc | null; loading: boolean; error?: string }>({ doc: null, loading: false });
  const selectionKey = JSON.stringify(selection);
  const key = JSON.stringify([modelId, selection]);
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    let active = true;
    setState({ id: key, doc: null, loading: !!modelId });
    if (!modelId) return;
    fetchModelParamsDoc(modelId, selection)
      .then((doc) => { if (active) setState({ id: key, doc, loading: false }); })
      .catch((error) => { if (active) setState({ id: key, doc: null, loading: false, error: error instanceof Error ? error.message : '模型参数加载失败' }); });
    return () => { active = false; };
  }, [modelId, selectionKey, revision]);
  const doc = state.id === key ? state.doc : null;
  return { doc, params: doc?.params ?? [], loading: !!modelId && (state.id !== key || state.loading), error: state.id === key ? state.error : undefined, retry };
}
