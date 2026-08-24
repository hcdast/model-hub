import { useCallback, useEffect } from 'react';
import { ModelConfigItem } from '../services/model-api';
import { fetchModelDetail } from '../services/model-cache';
import { useModels } from './useModels';
import { NodeType } from '../types/node-types';
import { nodeTypeSupportsModel } from '../utils/model-type-map';
import { extractDefaultParams } from '../utils/model-params.util';
import { WorkflowNodeData } from '../store/workflow-store';

interface Options {
  nodeId: string;
  nodeType: NodeType;
  modelId?: string;
  parameters?: Record<string, unknown>;
  onUpdateNode: (nodeId: string, data: Partial<WorkflowNodeData>) => void;
}

/** 节点模型与参数：列表加载、默认选中、切换时写入默认参数 */
export function useNodeModelConfig({
  nodeId,
  nodeType,
  modelId,
  parameters,
  onUpdateNode,
}: Options) {
  const supportsModel = nodeTypeSupportsModel(nodeType);
  const { models, loading } = useModels(supportsModel ? nodeType : undefined);

  // 无模型时自动选中列表第一项（不依赖 parameters 引用，避免重复触发）
  useEffect(() => {
    if (!supportsModel || loading || modelId || models.length === 0) return;

    const first = models[0];
    const defaults = extractDefaultParams(first.params);
    onUpdateNode(nodeId, {
      modelId: first.model_id,
      parameters: { ...parameters, ...defaults },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在首次无 modelId 时执行
  }, [supportsModel, loading, modelId, models.length, models[0]?.model_id, nodeId, onUpdateNode]);

  const updateModel = useCallback(async (nextModelId: string, model?: ModelConfigItem) => {
    const detail = model ?? await fetchModelDetail(nextModelId);
    const defaults = extractDefaultParams(detail?.params);
    onUpdateNode(nodeId, {
      modelId: nextModelId,
      parameters: { ...parameters, ...defaults },
    });
  }, [nodeId, parameters, onUpdateNode]);

  const updateParam = useCallback((key: string, value: unknown) => {
    onUpdateNode(nodeId, {
      parameters: { ...parameters, [key]: value },
    });
  }, [nodeId, parameters, onUpdateNode]);

  return { updateModel, updateParam, models, loading };
}
