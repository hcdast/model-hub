import { memo, useCallback } from 'react';
import { NodeProps } from 'reactflow';
import { Progress } from 'antd';
import { PictureOutlined } from '@ant-design/icons';
import { WorkflowNodeData } from '../../store/workflow-store';
import { getNodeDefinition } from '../../types/node-types';
import { useWorkflowEditor } from '../../contexts/WorkflowEditorContext';
import { useNodeModelConfig } from '../../hooks/useNodeModelConfig';
import { useNodePorts } from '../../hooks/useNodePorts';
import ExpandedNodeShell from './ExpandedNodeShell';
import InlineModelPicker from './InlineModelPicker';
import ModelParamChips from './ModelParamChips';
import NodeOutputPreview from './NodeOutputPreview';
import ModelExecutionControls from './ModelExecutionControls';

function TextToImageNode({ id, data, selected }: NodeProps<WorkflowNodeData>) {
  const { onRunNode, onUpdateNode } = useWorkflowEditor();
  const status = data.executionStatus || 'idle';
  const nodeDef = getNodeDefinition(data.type);
  const accentColor = nodeDef?.color || '#f59e0b';
  const prompt = typeof data.parameters?.prompt === 'string' ? data.parameters.prompt : '';
  const ports = useNodePorts(data.modelId);

  const { updateModel, updateParam } = useNodeModelConfig({
    nodeId: id,
    nodeType: data.type,
    modelId: data.modelId,
    parameters: data.parameters,
    onUpdateNode: onUpdateNode,
  });

  const updatePrompt = useCallback((value: string) => {
    updateParam('prompt', value);
  }, [updateParam]);

  return (
    <ExpandedNodeShell
      selected={selected}
      subLabel="Image"
      accentColor={accentColor}
      status={status}
      inputPorts={ports.inputPorts}
      outputPorts={ports.outputPorts}
      portState={ports}
      isRunning={status === 'running'}
      onRun={() => onRunNode(id)}
      nodeId={id}
      prompt={prompt}
      onPromptChange={updatePrompt}
      footerExtra={<ModelExecutionControls modelId={data.modelId} parameters={data.parameters} onParamChange={updateParam} />}
      collapsedContent={
        data.output ? (
          <NodeOutputPreview output={data.output} />
        ) : prompt ? (
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)', lineHeight: 1.75 }}>{prompt}</div>
        ) : (
          <div style={{ height: 48, borderRadius: 8, background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.25)', fontSize: 11 }}>
            <PictureOutlined style={{ marginRight: 6 }} />点击配置
          </div>
        )
      }
      expandedContent={
        <>
          <textarea
            className="tapnow-prompt-input nodrag nopan nowheel"
            aria-label="图片提示词"
            value={prompt}
            onChange={(e) => updatePrompt(e.target.value)}
            placeholder="描述你想生成的图片..."
            rows={1}
            style={{
              width: '100%', background: 'transparent', border: 'none', outline: 'none',
              resize: 'none', color: 'rgba(255,255,255,0.85)', fontSize: 13, lineHeight: 1.5, fontFamily: 'inherit', minHeight: 22,
            }}
          />
          {status === 'running' && (
            <Progress percent={data.progress || 0} size="small" strokeColor={accentColor} showInfo={false} style={{ marginTop: 8 }} />
          )}
        </>
      }
      footer={
        <>
          <InlineModelPicker nodeType={data.type} value={data.modelId} onChange={updateModel} />
          <ModelParamChips
            modelId={data.modelId}
            parameters={data.parameters}
            onParamChange={updateParam}
          />
        </>
      }
    />
  );
}

export default memo(TextToImageNode);
