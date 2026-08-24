import { useState } from 'react';
import { Input, Collapse, Badge } from 'antd';
import {
  SearchOutlined,
  PictureOutlined,
  VideoCameraOutlined,
  MessageOutlined,
  UserOutlined,
  AudioOutlined,
  ToolOutlined,
  SwapOutlined,
  BulbOutlined,
  LayoutOutlined,
  FileTextOutlined,
  PlayCircleOutlined,
  SyncOutlined,
  ZoomInOutlined,
  EditOutlined,
  ExpandOutlined,
  SkinOutlined,
  CustomerServiceOutlined,
  PlaySquareOutlined,
  BranchesOutlined,
  ReloadOutlined,
  ImportOutlined,
  ExportOutlined,
  AppstoreOutlined,
} from '@ant-design/icons';
import tokens from '../../theme/dark';
import { NODE_GROUPS, NodeCategory, NodeDefinition } from '../../types/node-types';

// 图标映射
const iconMap: Record<string, React.ReactNode> = {
  BulbOutlined: <BulbOutlined />,
  FileTextOutlined: <FileTextOutlined />,
  LayoutOutlined: <LayoutOutlined />,
  PictureOutlined: <PictureOutlined />,
  SwapOutlined: <SwapOutlined />,
  EditOutlined: <EditOutlined />,
  ZoomInOutlined: <ZoomInOutlined />,
  VideoCameraOutlined: <VideoCameraOutlined />,
  PlayCircleOutlined: <PlayCircleOutlined />,
  SyncOutlined: <SyncOutlined />,
  ExpandOutlined: <ExpandOutlined />,
  UserOutlined: <UserOutlined />,
  SkinOutlined: <SkinOutlined />,
  AudioOutlined: <AudioOutlined />,
  CustomerServiceOutlined: <CustomerServiceOutlined />,
  PlaySquareOutlined: <PlaySquareOutlined />,
  ToolOutlined: <ToolOutlined />,
  BranchesOutlined: <BranchesOutlined />,
  ReloadOutlined: <ReloadOutlined />,
  ImportOutlined: <ImportOutlined />,
  ExportOutlined: <ExportOutlined />,
  MessageOutlined: <MessageOutlined />,
  AppstoreOutlined: <AppstoreOutlined />,
};

// 分组图标
const categoryIcons: Record<NodeCategory, React.ReactNode> = {
  creative: <BulbOutlined />,
  image: <PictureOutlined />,
  video: <VideoCameraOutlined />,
  character: <UserOutlined />,
  audio: <AudioOutlined />,
  post: <ToolOutlined />,
  io: <SwapOutlined />,
};

export default function NodePalette() {
  const [searchValue, setSearchValue] = useState('');
  const [activeKeys, setActiveKeys] = useState<string[]>(['creative', 'image', 'video']);

  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  // 过滤节点
  const filteredGroups = NODE_GROUPS.map(group => ({
    ...group,
    nodes: group.nodes.filter(node =>
      node.label.toLowerCase().includes(searchValue.toLowerCase()) ||
      node.description.toLowerCase().includes(searchValue.toLowerCase())
    ),
  })).filter(group => group.nodes.length > 0);

  // 统计节点数量
  const totalNodes = filteredGroups.reduce((sum, group) => sum + group.nodes.length, 0);

  return (
    <div style={{
      padding: tokens.spacing.md,
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* 标题 */}
      <div style={{
        marginBottom: tokens.spacing.md,
      }}>
        <h3 style={{
          fontSize: tokens.font.size.base,
          fontWeight: tokens.font.weight.semibold,
          color: tokens.text.primary,
          margin: 0,
          marginBottom: tokens.spacing.xs,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span>Node Panel</span>
          <Badge
            count={totalNodes}
            style={{
              backgroundColor: tokens.accent.primary,
              fontSize: tokens.font.size.xs,
            }}
          />
        </h3>
        <p style={{
          fontSize: tokens.font.size.sm,
          color: tokens.text.tertiary,
          margin: 0,
        }}>
          Drag nodes to the canvas
        </p>
      </div>

      {/* 搜索框 */}
      <Input
        prefix={<SearchOutlined style={{ color: tokens.text.tertiary }} />}
        placeholder="Search nodes..."
        value={searchValue}
        onChange={(e) => setSearchValue(e.target.value)}
        style={{
          marginBottom: tokens.spacing.md,
          background: tokens.bg.tertiary,
          borderColor: tokens.border.default,
        }}
        allowClear
      />

      {/* 节点分组 */}
      <div style={{
        flex: 1,
        overflow: 'auto',
      }}>
        <Collapse
          activeKey={activeKeys}
          onChange={(keys) => setActiveKeys(keys as string[])}
          ghost
          items={filteredGroups.map(group => ({
            key: group.category,
            label: (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: tokens.spacing.sm,
                color: tokens.text.primary,
                fontWeight: tokens.font.weight.medium,
                fontSize: tokens.font.size.sm,
              }}>
                <span style={{ color: tokens.accent.primary }}>
                  {categoryIcons[group.category]}
                </span>
                <span>{group.label}</span>
                <Badge
                  count={group.nodes.length}
                  size="small"
                  style={{
                    backgroundColor: tokens.bg.hover,
                    color: tokens.text.tertiary,
                    fontSize: tokens.font.size.xs,
                  }}
                />
              </div>
            ),
            children: (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: tokens.spacing.xs,
              }}>
                {group.nodes.map(node => (
                  <NodeItem
                    key={node.type}
                    node={node}
                    onDragStart={onDragStart}
                  />
                ))}
              </div>
            ),
          }))}
        />
      </div>
    </div>
  );
}

// 节点项组件
function NodeItem({
  node,
  onDragStart,
}: {
  node: NodeDefinition;
  onDragStart: (event: React.DragEvent, nodeType: string) => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, node.type)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacing.md,
        padding: `${tokens.spacing.sm} ${tokens.spacing.md}`,
        background: tokens.bg.tertiary,
        border: `1px solid ${tokens.border.default}`,
        borderRadius: tokens.radius.md,
        cursor: 'grab',
        transition: 'all 0.2s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = node.color;
        e.currentTarget.style.background = `${node.color}10`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = tokens.border.default;
        e.currentTarget.style.background = tokens.bg.tertiary;
      }}
    >
      {/* 图标 */}
      <div style={{
        width: 32,
        height: 32,
        borderRadius: tokens.radius.sm,
        background: `${node.color}20`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        color: node.color,
        fontSize: 16,
      }}>
        {iconMap[node.icon] || <AppstoreOutlined />}
      </div>

      {/* 信息 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: tokens.font.size.sm,
          fontWeight: tokens.font.weight.medium,
          color: tokens.text.primary,
          marginBottom: 2,
        }}>
          {node.label}
        </div>
        <div style={{
          fontSize: tokens.font.size.xs,
          color: tokens.text.tertiary,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {node.description}
        </div>
      </div>

      {/* 拖拽指示器 */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        opacity: 0.3,
      }}>
        <div style={{
          width: 12,
          height: 2,
          background: tokens.text.tertiary,
          borderRadius: 1,
        }} />
        <div style={{
          width: 12,
          height: 2,
          background: tokens.text.tertiary,
          borderRadius: 1,
        }} />
        <div style={{
          width: 12,
          height: 2,
          background: tokens.text.tertiary,
          borderRadius: 1,
        }} />
      </div>
    </div>
  );
}
