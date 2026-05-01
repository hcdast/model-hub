import { Card, Space, Tag, Typography, Statistic, Row, Col } from 'antd';
import { ClockCircleOutlined } from '@ant-design/icons';
import CircuitBreakerStateTag from './CircuitBreakerStateTag';
import type { ProviderHealthOverview } from '../services/provider-health';

interface ProviderHealthCardProps {
  /** Provider 健康概览数据 */
  data: ProviderHealthOverview;
}

/**
 * Provider 健康摘要卡片组件
 * 展示单个 Provider 的熔断状态、成功率、平均延迟、错误率和最后状态转换时间
 * 手动覆盖激活时显示紫色覆盖指示器
 */
export default function ProviderHealthCard({ data }: ProviderHealthCardProps) {
  const {
    provider,
    circuitState,
    successRate,
    avgLatencyMs,
    errorRate,
    lastTransitionAt,
    hasManualOverride,
  } = data;

  return (
    <Card
      hoverable
      size="small"
      title={
        <Space>
          <Typography.Text strong>{provider}</Typography.Text>
          <CircuitBreakerStateTag state={circuitState} />
          {hasManualOverride && <Tag color="purple">手动覆盖</Tag>}
        </Space>
      }
    >
      <Row gutter={[16, 12]}>
        {/* 成功率 */}
        <Col span={8}>
          <Statistic
            title="成功率"
            value={successRate != null ? (successRate * 100).toFixed(1) : '—'}
            suffix={successRate != null ? '%' : undefined}
            valueStyle={{
              color: successRate != null && successRate < 0.9 ? '#cf1322' : '#3f8600',
              fontSize: 16,
            }}
          />
        </Col>
        {/* 平均延迟 */}
        <Col span={8}>
          <Statistic
            title="平均延迟"
            value={avgLatencyMs != null ? avgLatencyMs.toFixed(0) : '—'}
            suffix={avgLatencyMs != null ? 'ms' : undefined}
            valueStyle={{ fontSize: 16 }}
          />
        </Col>
        {/* 错误率 */}
        <Col span={8}>
          <Statistic
            title="错误率"
            value={errorRate != null ? (errorRate * 100).toFixed(1) : '—'}
            suffix={errorRate != null ? '%' : undefined}
            valueStyle={{
              color: errorRate != null && errorRate > 0.1 ? '#cf1322' : undefined,
              fontSize: 16,
            }}
          />
        </Col>
      </Row>

      {/* 最后状态转换时间 */}
      <div style={{ marginTop: 12, color: '#8c8c8c', fontSize: 12 }}>
        <ClockCircleOutlined style={{ marginRight: 4 }} />
        最后状态变更：{lastTransitionAt ? new Date(lastTransitionAt).toLocaleString() : '—'}
      </div>
    </Card>
  );
}
