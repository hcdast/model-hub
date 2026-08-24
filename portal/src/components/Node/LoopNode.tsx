import { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { ReloadOutlined } from '@ant-design/icons';
import tokens from '../../theme/dark';
import { WorkflowNodeData } from '../../store/workflow-store';

function LoopNode({ data, selected }: NodeProps<WorkflowNodeData>) {
  return (
    <div
      style={{
        background: tokens.bg.tertiary,
        border: `1px solid ${selected ? '#faad14' : tokens.border.default}`,
        borderRadius: tokens.radius.lg,
        padding: 0,
        minWidth: 180,
        boxShadow: selected ? `0 0 20px rgba(250, 173, 20, 0.3)` : tokens.shadow.sm,
        transition: 'all 0.2s ease',
        overflow: 'hidden',
      }}
    >
      {/* 头部 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacing.sm,
        padding: `${tokens.spacing.sm} ${tokens.spacing.md}`,
        background: 'rgba(250, 173, 20, 0.1)',
        borderBottom: `1px solid ${tokens.border.default}`,
      }}>
        <div style={{
          width: 24,
          height: 24,
          borderRadius: tokens.radius.sm,
          background: 'rgba(250, 173, 20, 0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <ReloadOutlined style={{ fontSize: 12, color: '#faad14' }} />
        </div>
        <span style={{
          flex: 1,
          fontSize: tokens.font.size.sm,
          fontWeight: tokens.font.weight.medium,
          color: tokens.text.primary,
        }}>
          {data.label || 'Loop'}
        </span>
      </div>

      {/* 内容 */}
      <div style={{
        padding: `${tokens.spacing.sm} ${tokens.spacing.md}`,
        minHeight: 40,
      }}>
        <span style={{
          fontSize: tokens.font.size.xs,
          color: tokens.text.tertiary,
        }}>
          {data.loopConfig?.outputMode === 'collect' ? 'Collect results' : 'Last result'}
        </span>
      </div>

      {/* 输入端口 */}
      <Handle
        type="target"
        position={Position.Left}
        id="array"
        style={{
          width: 10,
          height: 10,
          background: '#faad14',
          border: `2px solid ${tokens.bg.tertiary}`,
          left: -5,
        }}
      />

      {/* 输出端口 */}
      <Handle
        type="source"
        position={Position.Right}
        id="result"
        style={{
          width: 10,
          height: 10,
          background: '#faad14',
          border: `2px solid ${tokens.bg.tertiary}`,
          right: -5,
        }}
      />
    </div>
  );
}

export default memo(LoopNode);
