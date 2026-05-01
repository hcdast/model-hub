import { Tag } from 'antd';

/** 熔断状态对应的颜色映射 */
const stateColorMap: Record<string, { color: string; label: string }> = {
  CLOSED: { color: 'green', label: 'CLOSED' },
  OPEN: { color: 'red', label: 'OPEN' },
  HALF_OPEN: { color: 'orange', label: 'HALF_OPEN' },
};

interface CircuitBreakerStateTagProps {
  /** 熔断器状态：CLOSED / OPEN / HALF_OPEN */
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
}

/**
 * 熔断状态标签组件
 * - 绿色 = CLOSED（正常）
 * - 红色 = OPEN（熔断）
 * - 橙色 = HALF_OPEN（半开试探）
 */
export default function CircuitBreakerStateTag({ state }: CircuitBreakerStateTagProps) {
  const info = stateColorMap[state] || { color: 'default', label: state };
  return <Tag color={info.color}>{info.label}</Tag>;
}
