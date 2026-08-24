import { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { BranchesOutlined } from '@ant-design/icons';
import tokens from '../../theme/dark';
import { WorkflowNodeData } from '../../store/workflow-store';

function ConditionNode({ data, selected }: NodeProps<WorkflowNodeData>) {
  return (
    <div
      style={{
        background: tokens.bg.tertiary,
        border: `1px solid ${selected ? '#52c41a' : tokens.border.default}`,
        borderRadius: tokens.radius.lg,
        padding: 0,
        minWidth: 180,
        boxShadow: selected ? `0 0 20px rgba(82, 196, 26, 0.3)` : tokens.shadow.sm,
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
        background: 'rgba(82, 196, 26, 0.1)',
        borderBottom: `1px solid ${tokens.border.default}`,
      }}>
        <div style={{
          width: 24,
          height: 24,
          borderRadius: tokens.radius.sm,
          background: 'rgba(82, 196, 26, 0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <BranchesOutlined style={{ fontSize: 12, color: '#52c41a' }} />
        </div>
        <span style={{
          flex: 1,
          fontSize: tokens.font.size.sm,
          fontWeight: tokens.font.weight.medium,
          color: tokens.text.primary,
        }}>
          {data.label || 'Condition'}
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
          {data.conditions?.length || 0} branches
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
          background: '#52c41a',
          border: `2px solid ${tokens.bg.tertiary}`,
          left: -5,
        }}
      />

      {/* 输出端口 - Default */}
      <Handle
        type="source"
        position={Position.Right}
        id="default"
        style={{
          width: 10,
          height: 10,
          background: '#52c41a',
          border: `2px solid ${tokens.bg.tertiary}`,
          right: -5,
          top: '30%',
        }}
      />

      {/* 输出端口 - Branches */}
      {data.conditions?.map((cond, index) => (
        <Handle
          key={cond.branchId}
          type="source"
          position={Position.Right}
          id={cond.branchId}
          style={{
            width: 10,
            height: 10,
            background: tokens.accent.secondary,
            border: `2px solid ${tokens.bg.tertiary}`,
            right: -5,
            top: `${50 + index * 20}%`,
          }}
        />
      ))}
    </div>
  );
}

export default memo(ConditionNode);
