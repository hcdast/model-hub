import { Spin, Typography } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';

const { Text } = Typography;

/**
 * 加载状态组件属性
 */
interface LoadingStateProps {
  /** 加载提示文本 */
  tip?: string;
  /** 是否显示大尺寸 */
  large?: boolean;
  /** 自定义样式 */
  style?: React.CSSProperties;
}

/**
 * 加载状态组件
 * 提供统一的加载状态显示
 */
export function LoadingState({ tip = '加载中...', large = false, style }: LoadingStateProps) {
  const defaultStyle: React.CSSProperties = {
    textAlign: 'center',
    padding: large ? '100px 0' : '50px 0',
    ...style,
  };

  return (
    <div style={defaultStyle}>
      <Spin
        size={large ? 'large' : 'default'}
        indicator={<LoadingOutlined style={{ fontSize: large ? 48 : 24 }} spin />}
      />
      {tip && (
        <div style={{ marginTop: 16 }}>
          <Text type="secondary">{tip}</Text>
        </div>
      )}
    </div>
  );
}
