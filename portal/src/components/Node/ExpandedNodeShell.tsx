import { ReactNode, useEffect, useRef } from 'react';
import { Handle, Position, useUpdateNodeInternals } from 'reactflow';
import { LoadingOutlined, CheckCircleOutlined, CloseCircleOutlined, PlusOutlined, ExpandOutlined, ArrowUpOutlined, CopyOutlined, DeleteOutlined, SettingOutlined, HistoryOutlined } from '@ant-design/icons';
import tokens from '../../theme/dark';
import { PortConfig } from './BaseCreativeNode';
import { useWorkflowEditor } from '../../contexts/WorkflowEditorContext';
import SpeechInputButton from './SpeechInputButton';

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
  footerExtra?: ReactNode;
  nodeId: string;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  portState?: { loading: boolean; error: string; retry: () => void };
}

const statusIcons: Record<string, ReactNode> = {
  running: <LoadingOutlined aria-label="正在运行" style={{ color: tokens.accent.secondary }} />,
  success: <CheckCircleOutlined aria-label="运行成功" style={{ color: tokens.status.success }} />,
  error: <CloseCircleOutlined aria-label="运行失败" style={{ color: tokens.status.error }} />,
};
const NODE_WIDTH = 360;

export default function ExpandedNodeShell({ selected, subLabel, status = 'idle', inputPorts = [], outputPorts = [], collapsedContent, expandedContent, footer, onRun, isRunning, footerExtra, nodeId, prompt, onPromptChange, portState }: ExpandedNodeShellProps) {
  const editor = useWorkflowEditor();
  const updateNodeInternals = useUpdateNodeInternals();
  const portSignature = [...inputPorts.map((port) => `in:${port.id}`), ...outputPorts.map((port) => `out:${port.id}`)].join('|');
  useEffect(() => { updateNodeInternals(nodeId); }, [selected, nodeId, updateNodeInternals, portSignature]);
  const actions = [
    { label: '添加附件', icon: <PlusOutlined />, run: () => editor.onOpenAssets(nodeId) },
    { label: '复制节点', icon: <CopyOutlined />, run: () => editor.onCopyNode(nodeId) },
    { label: '删除节点', icon: <DeleteOutlined />, run: () => editor.onDeleteNode(nodeId) },
    { label: '完整参数', icon: <SettingOutlined />, run: () => editor.onOpenParameters(nodeId) },
    { label: '节点运行历史', icon: <HistoryOutlined />, run: () => editor.onOpenHistory(nodeId) },
    { label: '展开节点', icon: <ExpandOutlined />, run: () => editor.onExpandNode(nodeId) },
  ];
  return <div className="tapnow-node-stack" style={{ position: 'relative' }}>
    <div className={`tapnow-compact-card${selected ? ' tapnow-compact-card--active' : ''}`} style={{ background: tokens.bg.secondary, border: `1px solid ${status === 'error' ? tokens.status.error : selected ? tokens.border.focus : tokens.border.default}`, borderRadius: tokens.radius.md, width: NODE_WIDTH, minHeight: `calc(${Math.max(inputPorts.length, outputPorts.length) + 1} * ${tokens.spacing.lg})`, boxShadow: selected ? tokens.shadow.md : tokens.shadow.sm }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: tokens.spacing.xs, padding: tokens.spacing.sm, color: tokens.text.secondary, fontSize: tokens.font.size.xs }}>
        <span aria-hidden="true">≡</span><span>{subLabel}</span><span style={{ marginLeft: 'auto' }}>{statusIcons[status]}</span>
      </div>
      <div style={{ padding: tokens.spacing.sm }}>{collapsedContent}</div>
      {portState?.loading && <div role="status" style={{ padding: tokens.spacing.sm }}>正在加载连接端口…</div>}
      {portState?.error && <div role="alert" style={{ padding: tokens.spacing.sm, color: tokens.status.error }}>{portState.error}<button type="button" className="tapnow-footer-chip nodrag nopan" onClick={portState.retry}>重试加载端口</button></div>}
      {inputPorts.map((port, index) => <NodePort key={`target-${port.id}`} port={port} top={`${(index + 1) * 100 / (inputPorts.length + 1)}%`} nodeId={nodeId} direction="target" />)}
      {outputPorts.map((port, index) => <NodePort key={`source-${port.id}`} port={port} top={`${(index + 1) * 100 / (outputPorts.length + 1)}%`} nodeId={nodeId} direction="source" />)}
    </div>
    {selected && <div className="tapnow-control-panel nodrag nopan nowheel" style={{ marginTop: tokens.spacing.sm, background: tokens.bg.elevated, border: `1px solid ${tokens.border.default}`, borderRadius: tokens.radius.lg, width: NODE_WIDTH, boxShadow: tokens.shadow.md }}>
      <div role="toolbar" aria-label="节点操作" style={{ display: 'flex', justifyContent: 'space-between', padding: tokens.spacing.sm }}>
        {actions.map((action) => <button key={action.label} type="button" className="tapnow-icon-btn tapnow-icon-btn--sm" aria-label={action.label} title={action.label} onClick={(event) => { event.stopPropagation(); action.run(); }}>{action.icon}</button>)}
      </div>
      <div style={{ padding: tokens.spacing.sm }}>{expandedContent}</div>
      <div style={{ padding: tokens.spacing.sm, display: 'flex', flexDirection: 'column', gap: tokens.spacing.sm }}>
        {footer && <div className="tapnow-footer-chips">{footer}</div>}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: tokens.spacing.sm }}>
          {footerExtra}
          <SpeechInputButton prompt={prompt} onChange={onPromptChange} />
          {onRun && <button type="button" className="tapnow-send-btn" aria-label={isRunning ? '节点正在运行' : '运行节点'} title={isRunning ? '节点正在运行' : '运行节点'} onClick={(event) => { event.stopPropagation(); onRun(); }} disabled={isRunning}>{isRunning ? <LoadingOutlined /> : <ArrowUpOutlined />}</button>}
        </div>
      </div>
    </div>}
  </div>;
}

function NodePort({ port, nodeId, direction, top }: { port: PortConfig; nodeId: string; direction: 'source' | 'target'; top: string }) {
  const { onConnectPort } = useWorkflowEditor();
  const start = useRef<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);
  const label = `${direction === 'source' ? '输出' : '输入'}端口 ${port.id}：拖拽连线或点击选择连接目标`;
  return <Handle type={direction} position={direction === 'source' ? Position.Right : Position.Left} id={port.id}
    role="button" tabIndex={0} aria-label={label} title={label}
    className={`tapnow-handle tapnow-handle-${direction === 'source' ? 'output' : 'input'}`}
    onPointerDown={(event) => { start.current = { x: event.clientX, y: event.clientY }; dragged.current = false; }}
    onPointerMove={(event) => { if (start.current && Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > 4) dragged.current = true; }}
    onClick={(event) => { event.stopPropagation(); if (!dragged.current) onConnectPort(nodeId, port.id, direction); start.current = null; }}
    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onConnectPort(nodeId, port.id, direction); } }}
    style={{ [direction === 'source' ? 'right' : 'left']: -8, top, background: 'transparent', border: 'none', width: 16, height: 16 }} />;
}

export function FooterChip({ icon, label, onClick }: { icon?: ReactNode; label: string; onClick?: (event: React.MouseEvent) => void }) {
  return <button type="button" onClick={onClick} disabled={!onClick} title={label} className="tapnow-footer-chip">{icon}{label}</button>;
}
