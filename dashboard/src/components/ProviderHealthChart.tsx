import { useState, useMemo } from 'react';
import { Card, Radio, Space, Typography, Spin } from 'antd';
import { LineChartOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { providerHealthApi, type HealthHistoryPoint } from '../services/provider-health';
import { useRequest } from '../hooks/useRequest';

/** 时间范围选项 */
const TIME_RANGE_OPTIONS = [
  { label: '最近 1 小时', value: 1 },
  { label: '最近 6 小时', value: 6 },
  { label: '最近 24 小时', value: 24 },
];

/** 自动刷新间隔（毫秒） */
const AUTO_REFRESH_INTERVAL = 10000;

interface ProviderHealthChartProps {
  /** Provider 名称 */
  provider: string;
}

/**
 * Provider 健康趋势图表组件
 * 展示成功率、错误率、平均延迟的时间序列趋势图
 * 支持时间范围选择和 10 秒自动刷新
 */
export default function ProviderHealthChart({ provider }: ProviderHealthChartProps) {
  // 时间范围状态（小时）
  const [hours, setHours] = useState<number>(1);

  // 使用 useRequest hook 获取历史数据，支持 10 秒自动刷新
  const { data, loading } = useRequest<HealthHistoryPoint[]>(
    async () => {
      const res: any = await providerHealthApi.getHistory(provider, hours);
      return res.data?.points || res.points || [];
    },
    {
      deps: [provider, hours],
      pollingInterval: AUTO_REFRESH_INTERVAL,
    },
  );

  // 生成 ECharts 配置
  const chartOption = useMemo(() => buildHealthTrendOption(data || []), [data]);

  return (
    <Card
      title={
        <Space>
          <LineChartOutlined />
          <Typography.Text strong>健康趋势</Typography.Text>
        </Space>
      }
      extra={
        <Radio.Group
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          optionType="button"
          buttonStyle="solid"
          size="small"
          options={TIME_RANGE_OPTIONS}
        />
      }
    >
      {loading && !data ? (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin size="large" tip="加载中..." />
        </div>
      ) : (
        <ReactECharts
          option={chartOption}
          style={{ height: 360 }}
          notMerge
          lazyUpdate
        />
      )}
    </Card>
  );
}

/**
 * 生成健康趋势图的 ECharts 配置
 * 三条折线：成功率（绿色，左 Y 轴）、错误率（红色，左 Y 轴）、平均延迟（蓝色，右 Y 轴）
 */
function buildHealthTrendOption(points: HealthHistoryPoint[]): object {
  // 格式化时间戳为可读的时间标签
  const timestamps = points.map((p) => {
    const d = new Date(p.timestamp);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  });

  const successRates = points.map((p) =>
    p.successRate != null ? +(p.successRate * 100).toFixed(1) : null,
  );
  const errorRates = points.map((p) =>
    p.errorRate != null ? +(p.errorRate * 100).toFixed(1) : null,
  );
  const avgLatencies = points.map((p) =>
    p.avgLatencyMs != null ? +p.avgLatencyMs.toFixed(0) : null,
  );

  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
    },
    legend: {
      data: ['成功率', '错误率', '平均延迟'],
      bottom: 0,
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '12%',
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: timestamps,
    },
    yAxis: [
      {
        type: 'value',
        name: '百分比 (%)',
        min: 0,
        max: 100,
        axisLabel: { formatter: '{value}%' },
      },
      {
        type: 'value',
        name: '延迟 (ms)',
        min: 0,
        axisLabel: { formatter: '{value} ms' },
      },
    ],
    series: [
      {
        name: '成功率',
        type: 'line',
        smooth: true,
        data: successRates,
        yAxisIndex: 0,
        itemStyle: { color: '#52c41a' },
        lineStyle: { width: 2 },
        areaStyle: { color: 'rgba(82, 196, 26, 0.1)' },
      },
      {
        name: '错误率',
        type: 'line',
        smooth: true,
        data: errorRates,
        yAxisIndex: 0,
        itemStyle: { color: '#ff4d4f' },
        lineStyle: { width: 2 },
        areaStyle: { color: 'rgba(255, 77, 79, 0.1)' },
      },
      {
        name: '平均延迟',
        type: 'line',
        smooth: true,
        data: avgLatencies,
        yAxisIndex: 1,
        itemStyle: { color: '#1890ff' },
        lineStyle: { width: 2, type: 'dashed' },
      },
    ],
  };
}
