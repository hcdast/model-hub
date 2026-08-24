import { memo, useCallback } from 'react';
import { NodeProps } from 'reactflow';
import { WorkflowNodeData } from '../../store/workflow-store';
import { useWorkflowEditor } from '../../contexts/WorkflowEditorContext';
import { useNodeModelConfig } from '../../hooks/useNodeModelConfig';
import ExpandedNodeShell from './ExpandedNodeShell';
import InlineModelPicker from './InlineModelPicker';
import ModelParamChips from './ModelParamChips';

function AIAgentNode({ id, data, selected }: NodeProps<WorkflowNodeData>) {
  const { onRunNode, onUpdateNode } = useWorkflowEditor();
  const status = data.executionStatus || 'idle';
  const prompt = data.parameters?.prompt || '';

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
      subLabel="Text"
      accentColor="#6366f1"
      status={status}
      showTextToolbar={selected}
      nodeId={id}
      inputPorts={[{ id: 'context', position: 'middle' }]}
      outputPorts={[
        { id: 'text', position: 'top' },
        { id: 'json', position: 'bottom' },
      ]}
      isRunning={status === 'running'}
      onRun={() => onRunNode(id)}
      collapsedContent={
        prompt ? (
          <div style={{
            fontSize: 13,
            color: 'rgba(255,255,255,0.85)',
            lineHeight: 1.75,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            {prompt}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', fontStyle: 'italic', lineHeight: 1.4 }}>
            输入文本内容...
          </div>
        )
      }
      expandedContent={
        <textarea
          className="tapnow-prompt-input"
          value={prompt}
          onChange={(e) => updatePrompt(e.target.value)}
          placeholder="输出图片的描述文本"
          rows={1}
          style={{
            width: '100%',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            resize: 'none',
            color: 'rgba(255,255,255,0.85)',
            fontSize: 13,
            lineHeight: 1.5,
            fontFamily: 'inherit',
            minHeight: 22,
          }}
        />
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

export default memo(AIAgentNode);
