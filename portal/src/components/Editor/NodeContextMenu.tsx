import { useEffect, useRef } from 'react';
import {
  CopyOutlined,
  SnippetsOutlined,
  DeleteOutlined,
  PlayCircleOutlined,
  SaveOutlined,
  HistoryOutlined,
  ExportOutlined,
  QuestionCircleOutlined,
} from '@ant-design/icons';
import tokens from '../../theme/dark';

export interface ContextMenuItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  dividerBefore?: boolean;
  onClick: () => void;
}

interface Props {
  open: boolean;
  position: { x: number; y: number };
  nodeType?: string;
  onClose: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onRun: () => void;
  canPaste: boolean;
  canRun: boolean;
}

export default function NodeContextMenu({
  open,
  position,
  nodeType,
  onClose,
  onCopy,
  onPaste,
  onDuplicate,
  onDelete,
  onRun,
  canPaste,
  canRun,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const isMediaNode = nodeType && [
    'text-to-image', 'image-to-image', 'image-editor', 'image-upscale',
    'text-to-video', 'image-to-video', 'video-to-video', 'video-upscale',
    'character-create', 'face-swap', 'character-swap',
  ].includes(nodeType);

  const items: ContextMenuItem[] = [
    ...(isMediaNode ? [{
      key: 'save-asset',
      label: '保存到素材库',
      icon: <SaveOutlined />,
      onClick: () => { onClose(); },
    }] : []),
    ...(isMediaNode ? [{
      key: 'apply-history',
      label: '应用所有历史',
      icon: <HistoryOutlined />,
      onClick: () => { onClose(); },
    }] : []),
    {
      key: 'run',
      label: '运行此节点',
      icon: <PlayCircleOutlined />,
      disabled: !canRun,
      onClick: () => { onRun(); onClose(); },
    },
    {
      key: 'copy',
      label: '复制',
      icon: <CopyOutlined />,
      shortcut: 'CtrlC',
      onClick: () => { onCopy(); onClose(); },
    },
    {
      key: 'paste',
      label: '粘贴',
      icon: <SnippetsOutlined />,
      shortcut: 'CtrlV',
      disabled: !canPaste,
      onClick: () => { onPaste(); onClose(); },
    },
    {
      key: 'duplicate',
      label: '副本',
      icon: <CopyOutlined />,
      onClick: () => { onDuplicate(); onClose(); },
    },
    {
      key: 'delete',
      label: '删除',
      icon: <DeleteOutlined />,
      shortcut: 'Del',
      danger: true,
      dividerBefore: true,
      onClick: () => { onDelete(); onClose(); },
    },
    {
      key: 'clipboard',
      label: '复制到剪贴板',
      icon: <ExportOutlined />,
      onClick: () => { onCopy(); onClose(); },
    },
    {
      key: 'feedback',
      label: '反馈问题',
      icon: <QuestionCircleOutlined />,
      dividerBefore: true,
      onClick: () => { onClose(); },
    },
  ];

  // 调整位置避免超出视口
  const adjustedX = Math.min(position.x, window.innerWidth - 220);
  const adjustedY = Math.min(position.y, window.innerHeight - 400);

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left: adjustedX,
        top: adjustedY,
        zIndex: 1000,
        minWidth: 200,
        background: 'rgba(22, 22, 42, 0.96)',
        backdropFilter: 'blur(20px)',
        border: `1px solid ${tokens.border.default}`,
        borderRadius: 12,
        boxShadow: tokens.shadow.xl,
        padding: '6px 0',
        animation: 'fadeIn 0.12s ease',
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item) => (
        <div key={item.key}>
          {item.dividerBefore && (
            <div style={{ height: 1, background: tokens.border.default, margin: '4px 0' }} />
          )}
          <button
            type="button"
            disabled={item.disabled}
            onClick={item.onClick}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 14px',
              border: 'none',
              cursor: item.disabled ? 'not-allowed' : 'pointer',
              background: 'transparent',
              opacity: item.disabled ? 0.4 : 1,
              transition: 'background 0.12s ease',
            }}
            onMouseEnter={(e) => {
              if (!item.disabled) e.currentTarget.style.background = tokens.bg.hover;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            {item.icon && (
              <span style={{ color: item.danger ? tokens.status.error : tokens.text.secondary, fontSize: 14 }}>
                {item.icon}
              </span>
            )}
            <span style={{
              flex: 1,
              textAlign: 'left',
              fontSize: 13,
              color: item.danger ? tokens.status.error : tokens.text.primary,
            }}>
              {item.label}
            </span>
            {item.shortcut && (
              <span style={{ fontSize: 11, color: tokens.text.tertiary }}>
                {item.shortcut}
              </span>
            )}
          </button>
        </div>
      ))}
    </div>
  );
}
