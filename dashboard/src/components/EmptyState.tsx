import { Empty, Button } from 'antd';
import { PlusOutlined } from '@ant-design/icons';

/**
 * 空状态组件属性
 */
interface EmptyStateProps {
  /** 描述文本 */
  description?: string;
  /** 操作按钮文本 */
  actionText?: string;
  /** 操作按钮点击事件 */
  onAction?: () => void;
  /** 自定义样式 */
  style?: React.CSSProperties;
}

/**
 * 空状态组件
 * 提供统一的空状态显示
 */
export function EmptyState({
  description = '暂无数据',
  actionText,
  onAction,
  style,
}: EmptyStateProps) {
  const defaultStyle: React.CSSProperties = {
    padding: '50px 0',
    ...style,
  };

  return (
    <div style={defaultStyle}>
      <Empty
        description={description}
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      >
        {actionText && onAction && (
          <Button type="primary" icon={<PlusOutlined />} onClick={onAction}>
            {actionText}
          </Button>
        )}
      </Empty>
    </div>
  );
}
