import { memo, useCallback } from 'react';
import { NodeProps } from 'reactflow';
import { Progress } from 'antd';
import { PlayCircleOutlined, VideoCameraOutlined } from '@ant-design/icons';
import { WorkflowNodeData } from '../../store/workflow-store';
import { getNodeDefinition } from '../../types/node-types';
import { useWorkflowEditor } from '../../contexts/WorkflowEditorContext';
import { useNodeModelConfig } from '../../hooks/useNodeModelConfig';
import ExpandedNodeShell from './ExpandedNodeShell';
import InlineModelPicker from './InlineModelPicker';
import ModelParamChips from './ModelParamChips';

function TextToVideoNode({ id, data, selected }: NodeProps<WorkflowNodeData>) {
  const { onRunNode, onUpdateNode } = useWorkflowEditor();
  const status = data.executionStatus || 'idle';
  const nodeDef = getNodeDefinition(data.type);
  const accentColor = nodeDef?.color || '#3b82f6';
  const prompt = data.parameters?.prompt || '';
  const isRunning = status === 'running';

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
      subLabel="Video"
      accentColor={accentColor}
      status={status}
      inputPorts={[
        { id: 'prompt', position: 'top' },
        { id: 'reference', position: 'bottom' },
      ]}
      outputPorts={[{ id: 'video', position: 'middle' }]}
      isRunning={isRunning}
      onRun={() => onRunNode(id)}
      nodeId={id}
      collapsedContent={
        status === 'success' && data.output?.video ? (
          <div style={{ borderRadius: 10, overflow: 'hidden', background: '#0a0a0a', height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <PlayCircleOutlined style={{ fontSize: 32, color: accentColor, opacity: 0.7 }} />
          </div>
        ) : prompt ? (
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)', lineHeight: 1.75 }}>{prompt}</div>
        ) : (
          <div style={{ height: 48, borderRadius: 8, background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.25)', fontSize: 11 }}>
            <VideoCameraOutlined style={{ marginRight: 6 }} />点击配置
          </div>
        )
      }
      expandedContent={
        <>
          <textarea
            className="tapnow-prompt-input"
            value={prompt}
            onChange={(e) => updatePrompt(e.target.value)}
            placeholder="描述视频画面与运动..."
            rows={1}
            style={{
              width: '100%', background: 'transparent', border: 'none', outline: 'none',
              resize: 'none', color: 'rgba(255,255,255,0.85)', fontSize: 13, lineHeight: 1.5, fontFamily: 'inherit', minHeight: 22,
            }}
          />
          {isRunning && (
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

export default memo(TextToVideoNode);
