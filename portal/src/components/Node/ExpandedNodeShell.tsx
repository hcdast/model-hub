import { ReactNode, useEffect } from 'react';
import { Handle, Position, useUpdateNodeInternals } from 'reactflow';
import {
  LoadingOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  PlusOutlined,
  ExpandOutlined,
  ArrowUpOutlined,
  AudioOutlined,
  CopyOutlined,
  DeleteOutlined,
  OrderedListOutlined,
  AlignLeftOutlined,
} from '@ant-design/icons';
import tokens from '../../theme/dark';
import { PortConfig } from './BaseCreativeNode';

export interface ExpandedNodeShellProps {
  selected?: boolean;
  subLabel: string;
  accentColor: string;
  status?: 'idle' | 'running' | 'success' | 'error';
  inputPorts?: PortConfig[];
  outputPorts?: PortConfig[];
  collapsedContent: ReactNode;
  expandedContent: ReactNode;
  footer?: ReactNode;
  onRun?: () => void;
  isRunning?: boolean;
  showTextToolbar?: boolean;
  /** 底部右侧额外操作（如 1x、层数） */
  footerExtra?: ReactNode;
  /** 节点 ID，用于展开后更新 React Flow 尺寸测量 */
  nodeId?: string;
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

const NODE_WIDTH = 360;

/** TapNow 双层结构：紧凑预览卡片 + 下方控制面板 */
export default function ExpandedNodeShell({
  selected,
  subLabel,
  status = 'idle',
  inputPorts = [],
  outputPorts = [],
  collapsedContent,
  expandedContent,
  footer,
  onRun,
  isRunning,
  showTextToolbar,
  footerExtra,
  nodeId,
}: ExpandedNodeShellProps) {
  const hasError = status === 'error';
  const updateNodeInternals = useUpdateNodeInternals();

  useEffect(() => {
    if (nodeId) {
      updateNodeInternals(nodeId);
    }
  }, [selected, nodeId, updateNodeInternals]);

  return (
    <div className="tapnow-node-stack" style={{ position: 'relative' }}>
      {/* 浮动格式工具栏 — 在紧凑卡片上方 */}
      {selected && showTextToolbar && <TextFormatToolbar />}

      {/* 紧凑预览卡片 — 始终可见 */}
      <div
        className={`tapnow-compact-card${selected ? ' tapnow-compact-card--active' : ''}`}
        style={{
          background: '#141414',
          border: `1px solid ${selected ? 'rgba(255,255,255,0.18)' : hasError ? tokens.status.error : 'rgba(255,255,255,0.1)'}`,
          borderRadius: 12,
          width: NODE_WIDTH,
          boxShadow: selected ? '0 4px 16px rgba(0,0,0,0.35)' : '0 2px 8px rgba(0,0,0,0.2)',
          transition: 'border-color 0.2s, box-shadow 0.2s',
        }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          padding: '6px 12px 4px',
        }}>
          <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10 }}>≡</span>
          <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: 500 }}>{subLabel}</span>
          <div style={{ flex: 1 }} />
          {!selected && statusIcons[status]}
        </div>
        <div style={{ padding: '2px 12px 10px' }}>{collapsedContent}</div>
        {renderHandles(inputPorts, outputPorts, 'compact')}
      </div>

      {/* 控制面板 — 选中时在下方展开 */}
      {selected && (
        <div
          className="tapnow-control-panel nodrag nopan nowheel"
          style={{
            marginTop: 8,
            background: '#1c1c1c',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 14,
            width: NODE_WIDTH,
            boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
            overflow: 'visible',
          }}
        >
          {/* 面板顶栏：仅 + 和展开 */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 10px 0',
          }}>
            <button type="button" className="tapnow-icon-btn tapnow-icon-btn--sm">
              <PlusOutlined style={{ fontSize: 11 }} />
            </button>
            <button type="button" className="tapnow-icon-btn tapnow-icon-btn--sm">
              <ExpandOutlined style={{ fontSize: 10 }} />
            </button>
          </div>

          {/* 输入区 */}
          <div style={{ padding: '4px 14px 6px' }}>
            {expandedContent}
          </div>

          {/* 底栏：模型/参数 与 操作按钮分两行 */}
          <div style={{ padding: '0 10px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {footer && (
              <div className="tapnow-footer-chips">
                {footer}
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
              {footerExtra}
              <button type="button" className="tapnow-icon-btn tapnow-icon-btn--sm tapnow-icon-btn--plain">
                <AudioOutlined style={{ fontSize: 12 }} />
              </button>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>1x</span>
              <button type="button" className="tapnow-layer-badge">
                <AlignLeftOutlined style={{ fontSize: 9 }} />
                <span>4</span>
              </button>
              {onRun && (
                <button
                  type="button"
                  className="tapnow-send-btn"
                  onClick={(e) => { e.stopPropagation(); onRun(); }}
                  disabled={isRunning}
                >
                  {isRunning ? <LoadingOutlined style={{ fontSize: 12 }} /> : <ArrowUpOutlined style={{ fontSize: 12 }} />}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 文本浮动格式工具栏 */
function TextFormatToolbar() {
  const items = ['H1', 'H2', 'H3'];
  return (
    <div
      className="tapnow-float-toolbar nodrag nopan"
      style={{
        position: 'absolute',
        bottom: 'calc(100% + 10px)',
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        padding: '4px 8px',
        background: '#222',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 10,
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        whiteSpace: 'nowrap',
        zIndex: 10,
      }}
    >
      <span className="tapnow-color-dot" />
      {items.map((h) => (
        <button key={h} type="button" className="tapnow-fmt-btn">{h}</button>
      ))}
      <button type="button" className="tapnow-fmt-btn">¶</button>
      <span className="tapnow-toolbar-divider" />
      <button type="button" className="tapnow-fmt-btn"><strong>B</strong></button>
      <button type="button" className="tapnow-fmt-btn"><em>I</em></button>
      <button type="button" className="tapnow-fmt-btn"><OrderedListOutlined /></button>
      <button type="button" className="tapnow-fmt-btn"><UnorderedListIcon /></button>
      <span className="tapnow-toolbar-divider" />
      <button type="button" className="tapnow-fmt-btn"><CopyOutlined /></button>
      <button type="button" className="tapnow-fmt-btn"><DeleteOutlined /></button>
      <button type="button" className="tapnow-fmt-btn"><ExpandOutlined style={{ fontSize: 11 }} /></button>
    </div>
  );
}

function UnorderedListIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
      <circle cx="2" cy="3" r="1" /><rect x="4" y="2.5" width="7" height="1" rx="0.5" />
      <circle cx="2" cy="6" r="1" /><rect x="4" y="5.5" width="7" height="1" rx="0.5" />
      <circle cx="2" cy="9" r="1" /><rect x="4" y="8.5" width="7" height="1" rx="0.5" />
    </svg>
  );
}

function renderHandles(inputPorts: PortConfig[], outputPorts: PortConfig[], _variant: string) {
  return (
    <>
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
    </>
  );
}

/** 底部参数标签 */
export function FooterChip({ icon, label, onClick }: { icon?: ReactNode; label: string; onClick?: (e: React.MouseEvent) => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="tapnow-footer-chip"
    >
      {icon}
      {label}
    </button>
  );
}
