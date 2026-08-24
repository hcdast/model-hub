import { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Tag } from 'antd';
import {
  AppstoreOutlined,
  LoadingOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import tokens from '../../theme/dark';
import { WorkflowNodeData } from '../../store/workflow-store';

const statusIcons: Record<string, React.ReactNode> = {
  idle: null,
  running: <LoadingOutlined style={{ color: tokens.accent.secondary }} />,
  success: <CheckCircleOutlined style={{ color: tokens.status.success }} />,
  error: <CloseCircleOutlined style={{ color: tokens.status.error }} />,
};

function ModelNode({ data, selected }: NodeProps<WorkflowNodeData>) {
  const status = data.executionStatus || 'idle';
  const hasError = status === 'error';

  return (
    <div
      style={{
        background: tokens.bg.tertiary,
        border: `1px solid ${selected ? tokens.accent.primary : hasError ? tokens.status.error : tokens.border.default}`,
        borderRadius: tokens.radius.lg,
        padding: 0,
        minWidth: 200,
        boxShadow: selected ? tokens.shadow.glow : tokens.shadow.sm,
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
        {data.modelId ? (
          <Tag
            style={{
              background: `${tokens.accent.secondary}20`,
              color: tokens.accent.secondary,
              border: 'none',
              fontSize: tokens.font.size.xs,
              margin: 0,
            }}
          >
            {data.modelId}
          </Tag>
        ) : (
          <span style={{
            fontSize: tokens.font.size.xs,
            color: tokens.text.tertiary,
          }}>
            Click to configure
          </span>
        )}
      </div>

      {/* 输入端口 */}
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        style={{
          width: 10,
          height: 10,
          background: tokens.accent.primary,
          border: `2px solid ${tokens.bg.tertiary}`,
          left: -5,
        }}
      />

      {/* 输出端口 */}
      <Handle
        type="source"
        position={Position.Right}
        id="output"
        style={{
          width: 10,
          height: 10,
          background: tokens.accent.primary,
          border: `2px solid ${tokens.bg.tertiary}`,
          right: -5,
        }}
      />
    </div>
  );
}

export default memo(ModelNode);
