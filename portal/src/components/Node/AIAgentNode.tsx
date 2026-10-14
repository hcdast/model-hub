import { memo, useCallback } from 'react';
import { NodeProps } from 'reactflow';
import { WorkflowNodeData } from '../../store/workflow-store';
import { useWorkflowEditor } from '../../contexts/WorkflowEditorContext';
import { useNodeModelConfig } from '../../hooks/useNodeModelConfig';
import { useNodePorts } from '../../hooks/useNodePorts';
import tokens from '../../theme/dark';
import ExpandedNodeShell from './ExpandedNodeShell';
import InlineModelPicker from './InlineModelPicker';
import ModelParamChips from './ModelParamChips';
import ModelExecutionControls from './ModelExecutionControls';
import NodeOutputPreview from './NodeOutputPreview';
import StructuredTextEditor, { StructuredTextPreview } from './StructuredTextEditor';

function AIAgentNode({ id, data, selected }: NodeProps<WorkflowNodeData>) {
  const { onRunNode, onUpdateNode } = useWorkflowEditor();
  const status = data.executionStatus || 'idle';
  const prompt = typeof data.parameters?.prompt === 'string' ? data.parameters.prompt : '';
  const { updateModel, updateParam } = useNodeModelConfig({ nodeId: id, nodeType: data.type, modelId: data.modelId, parameters: data.parameters, onUpdateNode });
  const ports = useNodePorts(data.modelId);
  const updatePrompt = useCallback((value: string) => {
    onUpdateNode(id, { parameters: { ...data.parameters, prompt: value }, textDocument: { blocks: value.split('\n').map((text) => ({ type: 'paragraph', children: [{ text }] })) } });
  }, [id, data.parameters, onUpdateNode]);
  return <ExpandedNodeShell selected={selected} subLabel="Text" accentColor={tokens.accent.primary} status={status} nodeId={id}
    prompt={prompt} onPromptChange={updatePrompt}
    inputPorts={ports.inputPorts} outputPorts={ports.outputPorts} portState={ports}
    isRunning={status === 'running'} onRun={() => onRunNode(id)}
    collapsedContent={data.output ? <NodeOutputPreview output={data.output} /> : prompt ? <StructuredTextPreview value={data.textDocument} prompt={prompt} /> : <div style={{ color: tokens.text.secondary, fontSize: tokens.font.size.base }}>选中节点并输入文本内容…</div>}
    expandedContent={<StructuredTextEditor value={data.textDocument} prompt={prompt} onChange={(textDocument, text) => onUpdateNode(id, { textDocument, parameters: { ...data.parameters, prompt: text } })} />}
    footer={<><InlineModelPicker nodeType={data.type} value={data.modelId} onChange={updateModel} /><ModelParamChips modelId={data.modelId} parameters={data.parameters} onParamChange={updateParam} /></>}
    footerExtra={<ModelExecutionControls modelId={data.modelId} parameters={data.parameters} onParamChange={updateParam} />}
  />;
}

export default memo(AIAgentNode);
