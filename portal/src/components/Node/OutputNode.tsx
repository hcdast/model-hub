import { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { ExportOutlined } from '@ant-design/icons';
import tokens from '../../theme/dark';
import { WorkflowNodeData } from '../../store/workflow-store';

function OutputNode({ data, selected }: NodeProps<WorkflowNodeData>) {
  return (
    <div
      style={{
        background: tokens.bg.tertiary,
        border: `1px solid ${selected ? '#eb2f96' : tokens.border.default}`,
        borderRadius: tokens.radius.lg,
        padding: 0,
        minWidth: 160,
        boxShadow: selected ? `0 0 20px rgba(235, 47, 150, 0.3)` : tokens.shadow.sm,
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
        background: 'rgba(235, 47, 150, 0.1)',
        borderBottom: `1px solid ${tokens.border.default}`,
      }}>
        <div style={{
          width: 24,
          height: 24,
          borderRadius: tokens.radius.sm,
          background: 'rgba(235, 47, 150, 0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <ExportOutlined style={{ fontSize: 12, color: '#eb2f96' }} />
        </div>
        <span style={{
          flex: 1,
          fontSize: tokens.font.size.sm,
          fontWeight: tokens.font.weight.medium,
          color: tokens.text.primary,
        }}>
          {data.label || 'Output'}
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
          Workflow output
        </span>
      </div>

      {/* 输入端口 */}
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        style={{
          width: 10,
          height: 10,
          background: '#eb2f96',
          border: `2px solid ${tokens.bg.tertiary}`,
          left: -5,
        }}
      />
    </div>
  );
}

export default memo(OutputNode);
