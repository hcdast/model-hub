import { useState } from 'react';
import {
  FileTextOutlined,
  PictureOutlined,
  VideoCameraOutlined,
  AudioOutlined,
  GlobalOutlined,
  EditOutlined,
} from '@ant-design/icons';
import tokens from '../../theme/dark';
import { NodeType } from '../../types/node-types';

export interface AddNodeItem {
  type: NodeType;
  label: string;
  description?: string;
  icon: React.ReactNode;
  beta?: boolean;
}

const MAIN_NODES: AddNodeItem[] = [
  { type: 'ai-chat', label: '文本', description: '脚本、广告词、品牌文案', icon: <FileTextOutlined /> },
  { type: 'text-to-image', label: '图片', icon: <PictureOutlined /> },
  { type: 'text-to-video', label: '视频', icon: <VideoCameraOutlined /> },
  { type: 'text-to-speech', label: '音频', icon: <AudioOutlined /> },
  { type: 'storyboard', label: '3D 世界', icon: <GlobalOutlined />, beta: true },
];

const TOOL_NODES: AddNodeItem[] = [
  { type: 'image-editor', label: '图片编辑器', icon: <EditOutlined /> },
];

interface Props {
  open: boolean;
  position: { x: number; y: number };
  onSelect: (type: NodeType) => void;
  onClose: () => void;
}

export default function AddNodeMenu({ open, position, onSelect, onClose }: Props) {
  if (!open) return null;

  return (
    <>
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 29 }}
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      />
      <div
        style={{
          position: 'fixed',
          left: position.x,
          top: position.y,
          zIndex: 30,
          width: 240,
          background: 'rgba(22, 22, 42, 0.95)',
          backdropFilter: 'blur(20px)',
          border: `1px solid ${tokens.border.default}`,
          borderRadius: 16,
          boxShadow: tokens.shadow.xl,
          overflow: 'hidden',
          animation: 'fadeIn 0.15s ease',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <MenuSection title="添加节点" items={MAIN_NODES} onSelect={onSelect} />
        <MenuSection title="辅助工具" items={TOOL_NODES} onSelect={onSelect} isLast />
      </div>
    </>
  );
}

function MenuSection({
  title,
  items,
  onSelect,
  isLast,
}: {
  title: string;
  items: AddNodeItem[];
  onSelect: (type: NodeType) => void;
  isLast?: boolean;
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <div style={{ padding: '8px 0', borderBottom: isLast ? 'none' : `1px solid ${tokens.border.default}` }}>
      <div style={{
        padding: '4px 16px 8px',
        fontSize: 11,
        color: tokens.text.tertiary,
        fontWeight: 500,
      }}>
        {title}
      </div>
      {items.map((item) => (
        <button
          key={item.type}
          type="button"
          onClick={() => onSelect(item.type)}
          onMouseEnter={() => setHovered(item.type)}
          onMouseLeave={() => setHovered(null)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 16px',
            border: 'none',
            cursor: 'pointer',
            background: hovered === item.type ? tokens.bg.hover : 'transparent',
            textAlign: 'left',
            transition: 'background 0.12s ease',
          }}
        >
          <span style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: tokens.bg.elevated,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: tokens.text.secondary,
            fontSize: 16,
            flexShrink: 0,
          }}>
            {item.icon}
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
              color: tokens.text.primary,
              fontWeight: 500,
            }}>
              {item.label}
              {item.beta && (
                <span style={{
                  fontSize: 10,
                  padding: '1px 6px',
                  borderRadius: 4,
                  background: `${tokens.accent.primary}30`,
                  color: tokens.accent.primary,
                }}>
                  Beta
                </span>
              )}
            </span>
            {item.description && (
              <span style={{
                display: 'block',
                fontSize: 11,
                color: tokens.text.tertiary,
                marginTop: 2,
              }}>
                {item.description}
              </span>
            )}
          </span>
        </button>
      ))}
    </div>
  );
}
