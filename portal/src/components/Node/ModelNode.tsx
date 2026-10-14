import { memo, useEffect } from 'react';
import { Handle, Position, NodeProps, useUpdateNodeInternals } from 'reactflow';
import { Button } from 'antd';
import {
  AppstoreOutlined,
  LoadingOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import tokens from '../../theme/dark';
import { WorkflowNodeData } from '../../store/workflow-store';
import { useWorkflowEditor } from '../../contexts/WorkflowEditorContext';
import { useNodeModelConfig } from '../../hooks/useNodeModelConfig';
import InlineModelPicker from './InlineModelPicker';
import ModelParamChips from './ModelParamChips';
import NodeOutputPreview from './NodeOutputPreview';
import { useNodePorts } from '../../hooks/useNodePorts';

const statusIcons: Record<string, React.ReactNode> = {
  idle: null,
  running: <LoadingOutlined style={{ color: tokens.accent.secondary }} />,
  success: <CheckCircleOutlined style={{ color: tokens.status.success }} />,
  error: <CloseCircleOutlined style={{ color: tokens.status.error }} />,
};

function ModelNode({ id, data, selected }: NodeProps<WorkflowNodeData>) {
  const { onUpdateNode, onOpenParameters, onRunNode, onConnectPort } = useWorkflowEditor();
  const { updateModel, updateParam } = useNodeModelConfig({ nodeId: id, nodeType: data.type, modelId: data.modelId, parameters: data.parameters, onUpdateNode });
  const ports = useNodePorts(data.modelId);
  const updateInternals = useUpdateNodeInternals();
  const portIds = JSON.stringify([ports.inputPorts.map((port) => port.id), ports.outputPorts.map((port) => port.id)]);
  useEffect(() => { updateInternals(id); }, [id, portIds, updateInternals]);
  const status = data.executionStatus || 'idle';
  const hasError = status === 'error';

  return (
    <div
      style={{
        background: tokens.bg.tertiary,
        minHeight: Math.max(ports.inputPorts.length, ports.outputPorts.length) * 24 + 24,
        border: `1px solid ${selected ? tokens.accent.primary : hasError ? tokens.status.error : tokens.border.default}`,
        borderRadius: tokens.radius.lg,
        padding: 0,
        minWidth: 200,
        boxShadow: selected ? tokens.shadow.glow : tokens.shadow.sm,
        transition: 'all 0.2s ease',
        overflow: 'visible',
      }}
    >
      {/* 头部 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacing.sm,
        padding: `${tokens.spacing.sm} ${tokens.spacing.md}`,
        background: `${tokens.accent.primary}15`,
        borderBottom: `1px solid ${tokens.border.default}`,
      }}>
        <div style={{
          width: 24,
          height: 24,
          borderRadius: tokens.radius.sm,
          background: `${tokens.accent.primary}30`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <AppstoreOutlined style={{ fontSize: 12, color: tokens.accent.primary }} />
        </div>
        <span style={{
          flex: 1,
          fontSize: tokens.font.size.sm,
          fontWeight: tokens.font.weight.medium,
          color: tokens.text.primary,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {data.label || 'Model'}
        </span>
        {statusIcons[status] && (
          <span style={{ fontSize: 12 }}>
            {statusIcons[status]}
          </span>
        )}
      </div>

      {/* 内容 */}
      <div style={{
        padding: `${tokens.spacing.sm} ${tokens.spacing.md}`,
        minHeight: 40,
      }}>
        <div className="nodrag nowheel" style={{ maxWidth: 360 }}>
          <InlineModelPicker nodeType={data.type} value={data.modelId} onChange={updateModel} />
          <ModelParamChips modelId={data.modelId} parameters={data.parameters} onParamChange={updateParam} />
          <Button onClick={() => onOpenParameters(id)}>完整配置</Button>
          <Button disabled={status === 'running'} onClick={() => onRunNode(id)}>运行节点</Button>
          {ports.loading && <div>端口加载中…</div>}
          {ports.error && <div role="alert">{ports.error}<Button onClick={ports.retry}>重试端口</Button></div>}
          {data.output !== undefined && <NodeOutputPreview output={data.output} />}
        </div>
      </div>

      {ports.inputPorts.map((port, index) => <Handle key={`target:${port.id}`} type="target" position={Position.Left} id={port.id} title={`输入：${port.displayName || port.name}（${port.dataType}）`} onClick={(event) => { event.stopPropagation(); onConnectPort(id, port.id, 'target'); }} style={{ width: 10, height: 10, background: tokens.accent.primary, border: `2px solid ${tokens.bg.tertiary}`, left: -5, top: `${(index + 1) * 100 / (ports.inputPorts.length + 1)}%` }} />)}
      {ports.outputPorts.map((port, index) => <Handle key={`source:${port.id}`} type="source" position={Position.Right} id={port.id} title={`输出：${port.displayName || port.name}（${port.dataType}）`} onClick={(event) => { event.stopPropagation(); onConnectPort(id, port.id, 'source'); }} style={{ width: 10, height: 10, background: tokens.accent.primary, border: `2px solid ${tokens.bg.tertiary}`, right: -5, top: `${(index + 1) * 100 / (ports.outputPorts.length + 1)}%` }} />)}
    </div>
  );
}

export default memo(ModelNode);
