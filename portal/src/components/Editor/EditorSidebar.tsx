import { useRef, useState } from 'react';
import {
  PlusOutlined,
  FolderOutlined,
  LayoutOutlined,
  MessageOutlined,
  HistoryOutlined,
} from '@ant-design/icons';
import tokens from '../../theme/dark';

export type SidebarAction = 'add' | 'assets' | 'templates' | 'chat' | 'history';

interface Props {
  activeAction?: SidebarAction | null;
  onAction: (action: SidebarAction) => void;
  userInitial?: string;
}

const items: { key: SidebarAction; icon: React.ReactNode; label: string }[] = [
  { key: 'assets', icon: <FolderOutlined />, label: '素材库' },
  { key: 'templates', icon: <LayoutOutlined />, label: '模板' },
  { key: 'chat', icon: <MessageOutlined />, label: '对话' },
  { key: 'history', icon: <HistoryOutlined />, label: '历史' },
];

export default function EditorSidebar({ activeAction, onAction, userInitial = 'C' }: Props) {
  return (
    <div
      style={{
        position: 'absolute',
        left: 16,
        top: '50%',
        transform: 'translateY(-50%)',
        zIndex: 20,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        padding: '10px 8px',
        background: 'rgba(22, 22, 42, 0.85)',
        backdropFilter: 'blur(16px)',
        border: `1px solid ${tokens.border.default}`,
        borderRadius: 20,
        boxShadow: tokens.shadow.lg,
      }}
    >
      {/* 添加节点 */}
      <SidebarButton
        active={activeAction === 'add'}
        onClick={() => onAction('add')}
        tooltip="添加节点"
        highlight
      >
        <PlusOutlined style={{ fontSize: 18, color: tokens.text.inverse }} />
      </SidebarButton>

      <div style={{ width: 24, height: 1, background: tokens.border.default, margin: '4px 0' }} />

      {items.map((item) => (
        <SidebarButton
          key={item.key}
          active={activeAction === item.key}
          onClick={() => onAction(item.key)}
          tooltip={item.label}
        >
          {item.icon}
        </SidebarButton>
      ))}

      <div style={{ width: 24, height: 1, background: tokens.border.default, margin: '4px 0' }} />

      {/* 用户头像 */}
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          background: tokens.accent.primary,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 14,
          fontWeight: 600,
          color: '#fff',
          cursor: 'default',
        }}
      >
        {userInitial}
      </div>
    </div>
  );
}

function SidebarButton({
  children,
  active,
  onClick,
  tooltip,
  highlight,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick: () => void;
  tooltip: string;
  highlight?: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [showTip, setShowTip] = useState(false);

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        onMouseEnter={() => setShowTip(true)}
        onMouseLeave={() => setShowTip(false)}
        style={{
          width: highlight ? 40 : 36,
          height: highlight ? 40 : 36,
          borderRadius: highlight ? '50%' : 10,
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: highlight
            ? '#fff'
            : active
              ? tokens.bg.hover
              : 'transparent',
          color: highlight ? tokens.text.inverse : tokens.text.secondary,
          transition: 'all 0.15s ease',
          position: 'relative',
        }}
      >
        {children}
        {highlight && (
          <span
            style={{
              position: 'absolute',
              top: 2,
              right: 2,
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: tokens.accent.primary,
              border: `2px solid ${tokens.bg.secondary}`,
            }}
          />
        )}
      </button>
      {showTip && (
        <div
          style={{
            position: 'absolute',
            left: 'calc(100% + 10px)',
            top: '50%',
            transform: 'translateY(-50%)',
            padding: '6px 12px',
            background: tokens.bg.elevated,
            border: `1px solid ${tokens.border.default}`,
            borderRadius: 8,
            fontSize: 12,
            color: tokens.text.primary,
            whiteSpace: 'nowrap',
            boxShadow: tokens.shadow.md,
            pointerEvents: 'none',
            zIndex: 100,
          }}
        >
          {tooltip}
        </div>
      )}
    </div>
  );
}
