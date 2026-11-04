import { useCallback, useEffect, useRef } from 'react';
import { ModelConfigItem } from '../services/model-api';
import { fetchModelDetail } from '../services/model-cache';
import { useModels } from './useModels';
import { NodeType } from '../types/node-types';
import { compatibleParams } from '../utils/model-params.util';
import { WorkflowNodeData } from '../store/workflow-store';

interface Options {
  nodeId: string;
  nodeType: NodeType;
  modelId?: string;
  parameters?: Record<string, unknown>;
  onUpdateNode: (nodeId: string, data: Partial<WorkflowNodeData>) => void;
}

/** 只有用户明确选中模型才初始化默认值；异步详情不能覆盖后续模型选择或用户输入。 */
export function useNodeModelConfig(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const sequence = useRef(0);
  useEffect(() => () => { sequence.current += 1; }, [options.nodeId]);
  const list = useModels(options.nodeType);
  const updateModel = useCallback(async (nextModelId: string, model?: ModelConfigItem) => {
    const request = ++sequence.current;
    const initial = latest.current;
    const detail = model?.params ? model : await fetchModelDetail(nextModelId, model ? { configId: model._id, featureType: model.model_type, provider: model.provider } : undefined);
    if (request !== sequence.current || latest.current.nodeId !== initial.nodeId || latest.current.modelId !== initial.modelId) return;
    if (detail.disabled) throw new Error('该模型已停用，请选择其他模型');
    latest.current.onUpdateNode(initial.nodeId, {
      modelId: nextModelId,
      modelSelection: { configId: detail._id, configRevision: detail.revision || 0, featureType: detail.model_type, provider: detail.provider },
      parameters: compatibleParams(latest.current.parameters ?? {}, detail.params ?? {}),
    });
  }, []);
  const updateParam = useCallback((key: string, value: unknown) => {
    const current = latest.current;
    const parameters = { ...current.parameters };
    if (value === undefined) delete parameters[key];
    else parameters[key] = value;
    current.onUpdateNode(current.nodeId, { parameters });
  }, []);
  return { updateModel, updateParam, ...list };
}
