import { ReactNode } from 'react';
import { Handle, Position } from 'reactflow';
import {
  LoadingOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import tokens from '../../theme/dark';

export interface PortConfig {
  id: string;
  position?: 'top' | 'middle' | 'bottom';
}

export interface BaseCreativeNodeProps {
  selected?: boolean;
  label: string;
  subLabel?: string;
  icon?: ReactNode;
  accentColor: string;
  status?: 'idle' | 'running' | 'success' | 'error';
  inputPorts?: PortConfig[];
  outputPorts?: PortConfig[];
  children?: ReactNode;
  minWidth?: number;
  showRunButton?: boolean;
  onRun?: () => void;
}

const statusIcons: Record<string, ReactNode> = {
  running: <LoadingOutlined style={{ color: tokens.accent.secondary }} />,
  success: <CheckCircleOutlined style={{ color: tokens.status.success }} />,
  error: <CloseCircleOutlined style={{ color: tokens.status.error }} />,
};

const positionMap: Record<string, string> = {
  top: '25%',
  middle: '50%',
  bottom: '75%',
};

export default function BaseCreativeNode({
  selected,
  label,
  subLabel,
  accentColor,
  status = 'idle',
  inputPorts = [{ id: 'input', position: 'middle' }],
  outputPorts = [{ id: 'output', position: 'middle' }],
  children,
  minWidth = 240,
  showRunButton,
  onRun,
}: BaseCreativeNodeProps) {
  const hasError = status === 'error';

  return (
    <div
      className="tapnow-node"
      style={{
        background: 'rgba(22, 22, 42, 0.92)',
        backdropFilter: 'blur(12px)',
        border: `1px solid ${selected ? accentColor : hasError ? tokens.status.error : 'rgba(255,255,255,0.08)'}`,
        borderRadius: 16,
        minWidth,
        boxShadow: selected
          ? `0 0 0 1px ${accentColor}40, 0 8px 32px rgba(0,0,0,0.4)`
          : '0 4px 20px rgba(0,0,0,0.3)',
        transition: 'all 0.2s ease',
        overflow: 'visible',
      }}
    >
      {/* 头部 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 14px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <span style={{ color: tokens.text.tertiary, fontSize: 12 }}>≡</span>
        <span style={{ color: tokens.text.secondary, fontSize: 13, fontWeight: 500 }}>
          {subLabel || label}
        </span>
        <div style={{ flex: 1 }} />
        {statusIcons[status] && (
          <span style={{ fontSize: 13 }}>{statusIcons[status]}</span>
        )}
        {showRunButton && onRun && (
          <button
            type="button"
            className="tapnow-node-run-btn"
            onClick={(e) => { e.stopPropagation(); onRun(); }}
            style={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              border: 'none',
              background: accentColor,
              color: '#fff',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 10,
            }}
          >
            ▶
          </button>
        )}
      </div>

      {/* 内容区 */}
      <div style={{ padding: '12px 14px' }}>
        {children}
      </div>

      {/* 输入端口 - TapNow + 样式 */}
      {inputPorts.map((port) => (
        <Handle
          key={`in-${port.id}`}
          type="target"
          position={Position.Left}
          id={port.id}
          className="tapnow-handle tapnow-handle-input"
          style={{
            left: -8,
            top: positionMap[port.position || 'middle'],
            background: 'transparent',
            border: 'none',
            width: 16,
            height: 16,
          }}
        />
      ))}

      {/* 输出端口 */}
      {outputPorts.map((port) => (
        <Handle
          key={`out-${port.id}`}
          type="source"
          position={Position.Right}
          id={port.id}
          className="tapnow-handle tapnow-handle-output"
          style={{
            right: -8,
            top: positionMap[port.position || 'middle'],
            background: 'transparent',
            border: 'none',
            width: 16,
            height: 16,
          }}
        />
      ))}
    </div>
  );
}
