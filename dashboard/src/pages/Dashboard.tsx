import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Row, Col, Card, Typography, Spin, Table, Button, Space, Tag, Badge } from 'antd';
import {
  CheckCircleOutlined, CloseCircleOutlined,
  CloudServerOutlined, ThunderboltOutlined,
  ClockCircleOutlined, StopOutlined,
  ReloadOutlined,
  DollarOutlined, StarOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import ReactEChartsCore from 'echarts-for-react';
import StatCard from '../components/StatCard';
import StatusTag from '../components/StatusTag';
import { overviewApi, statsApi, taskApi } from '../services/api';
import { formatDateTime } from '../utils/format-helpers';
import {
  aggregateDailySummary,
  buildTaskVolumeOption,
  buildSuccessRateOption,
  DailySummary,
} from '../utils/trend-chart-helpers';

export default function DashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [dailySummary, setDailySummary] = useState<DailySummary[]>([]);
  const [recentFailures, setRecentFailures] = useState<any[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [costData, setCostData] = useState<any>(null);

  const fetchData = async () => {
    // 获取总览数据
    try {
      const res: any = await overviewApi.getOverview();
      setData(res.data);
    } catch { /* ignore */ }

    // 获取成本观测数据（独立 try-catch）
    try {
      const costRes: any = await overviewApi.getCostOverview();
      setCostData(costRes.data);
    } catch { /* 成本数据获取失败不影响页面其他模块 */ }

    // 获取近 7 天趋势数据（独立 try-catch，不影响总览数据）
    try {
      const dateTo = dayjs().format('YYYY-MM-DD');
      const dateFrom = dayjs().subtract(6, 'day').format('YYYY-MM-DD');
      const statsRes: any = await statsApi.daily({ dateFrom, dateTo, pageSize: 100 });
      const records = statsRes.data?.items || statsRes.data || [];
      setDailySummary(aggregateDailySummary(records));
    } catch { /* 趋势数据获取失败不影响页面其他模块 */ }

    // 获取最近失败/超时任务（独立 try-catch，不影响其他数据获取）
    try {
      const [failedRes, timeoutRes]: any[] = await Promise.all([
        taskApi.list({ status: 'FAILED', pageSize: 5 }),
        taskApi.list({ status: 'TIMEOUT', pageSize: 5 }),
      ]);
      const failedItems = failedRes.data?.items || [];
      const timeoutItems = timeoutRes.data?.items || [];
      const merged = [...failedItems, ...timeoutItems]
        .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 10);
      setRecentFailures(merged);
    } catch { /* 最近失败任务获取失败不影响页面其他模块 */ }

    setLoading(false);
    setLastUpdated(new Date());
  };

  // 手动刷新
  const handleManualRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, 30000);
    return () => clearInterval(timer);
  }, []);

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '120px auto' }} />;

  const today = data?.today || {};
  const total = data?.total || {};
  const queues = data?.queues || {};

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Dashboard 总览</Typography.Title>
        <Space>
          {lastUpdated && (
            <Typography.Text type="secondary">
              最后更新：{lastUpdated.toLocaleTimeString('zh-CN')}
            </Typography.Text>
          )}
          <Button
            icon={<ReloadOutlined />}
            loading={refreshing}
            onClick={handleManualRefresh}
          >
            刷新
          </Button>
        </Space>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={4}>
          <StatCard
            title="今日任务总量"
            value={today.totalTasks || 0}
            prefix={<CloudServerOutlined />}
          />
        </Col>
        <Col xs={24} sm={12} lg={4}>
          <StatCard
            title="今日成功率"
            value={today.successRate?.toFixed(1) || '0.0'}
            suffix="%"
            prefix={<CheckCircleOutlined />}
            valueStyle={{ color: (today.successRate || 0) >= 95 ? '#52c41a' : '#faad14' }}
          />
        </Col>
        <Col xs={24} sm={12} lg={4}>
          <StatCard
            title="全部任务总量"
            value={total.totalTasks || 0}
            prefix={<CloudServerOutlined />}
          />
        </Col>
        <Col xs={24} sm={12} lg={4}>
          <StatCard
            title="全部成功率"
            value={total.successRate?.toFixed(1) || '0.0'}
            suffix="%"
            prefix={<CheckCircleOutlined />}
            valueStyle={{ color: (total.successRate || 0) >= 95 ? '#52c41a' : '#faad14' }}
          />
        </Col>
        <Col xs={24} sm={12} lg={4}>
          <StatCard
            title="当前队列深度"
            value={queues.totalDepth || 0}
            prefix={<ThunderboltOutlined />}
            valueStyle={{ color: (queues.totalDepth || 0) > 100 ? '#ff4d4f' : undefined }}
          />
        </Col>
        <Col xs={24} sm={12} lg={4}>
          <StatCard
            title="当前处理中"
            value={queues.totalActive || 0}
            prefix={<CloudServerOutlined />}
          />
        </Col>
      </Row>

      {/* 成本观测 */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} sm={12} lg={6}>
          <StatCard
            title="模型消耗"
            value={costData?.totalSpend?.toFixed(4) || '0.0000'}
            prefix={<DollarOutlined />}
            suffix="credits"
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard
            title="路由成本"
            value="0.0000"
            prefix={<DollarOutlined />}
            suffix="credits"
            valueStyle={{ color: '#8c8c8c' }}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard
            title="缓存节省"
            value="0.0000"
            prefix={<DollarOutlined />}
            suffix="credits"
            valueStyle={{ color: '#52c41a' }}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard
            title="热门模型"
            value={costData?.topModel?.model || '--'}
            prefix={<StarOutlined />}
            suffix={costData?.topModel ? `(${costData.topModel.requestCount}次)` : undefined}
          />
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
        <Col xs={24} lg={8}>
          <Card title="今日任务统计">
            <Row gutter={16}>
              <Col span={6}><StatCard title="成功" value={today.successTasks || 0} valueStyle={{ color: '#52c41a' }} /></Col>
              <Col span={6}><StatCard title="失败" value={today.failedTasks || 0} valueStyle={{ color: '#ff4d4f' }} prefix={<CloseCircleOutlined />} /></Col>
              <Col span={6}><StatCard title="超时" value={today.timeoutTasks || 0} valueStyle={{ color: '#faad14' }} prefix={<ClockCircleOutlined />} /></Col>
              <Col span={6}><StatCard title="总量" value={today.totalTasks || 0} /></Col>
            </Row>
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title="全部数据统计">
            <Row gutter={16}>
              <Col span={6}><StatCard title="成功" value={total.successTasks || 0} valueStyle={{ color: '#52c41a' }} /></Col>
              <Col span={6}><StatCard title="失败" value={total.failedTasks || 0} valueStyle={{ color: '#ff4d4f' }} prefix={<CloseCircleOutlined />} /></Col>
              <Col span={6}><StatCard title="超时" value={total.timeoutTasks || 0} valueStyle={{ color: '#faad14' }} prefix={<ClockCircleOutlined />} /></Col>
              <Col span={6}><StatCard title="总量" value={total.totalTasks || 0} /></Col>
            </Row>
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card
            title={
              <span>
                队列状态
                {(queues.totalDepth || 0) > 50 && (
                  <Badge status="error" style={{ marginLeft: 8 }} />
                )}
              </span>
            }
            style={(queues.totalDepth || 0) > 100 ? { borderLeft: '3px solid #ff4d4f' } : undefined}
          >
            <Row gutter={16}>
              <Col span={12}><StatCard title="等待+延迟" value={queues.totalDepth || 0} /></Col>
              <Col span={12}><StatCard title="处理中" value={queues.totalActive || 0} /></Col>
            </Row>
            <Row style={{ marginTop: 12, textAlign: 'center' }}>
              <Col span={24}>
                {(queues.totalDepth || 0) <= 50 && <Tag color="success">健康</Tag>}
                {(queues.totalDepth || 0) > 50 && (queues.totalDepth || 0) <= 100 && <Tag color="warning">注意</Tag>}
                {(queues.totalDepth || 0) > 100 && <Tag color="error">告警</Tag>}
              </Col>
            </Row>
          </Card>
        </Col>
      </Row>

      {/* 近 7 天趋势图表 */}
      <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
        <Col lg={12} xs={24}>
          <Card title="近 7 天任务量趋势">
            {dailySummary.length > 0 ? (
              <ReactEChartsCore option={buildTaskVolumeOption(dailySummary)} style={{ height: 300 }} />
            ) : (
              <Typography.Text type="secondary">暂无趋势数据</Typography.Text>
            )}
          </Card>
        </Col>
        <Col lg={12} xs={24}>
          <Card title="近 7 天成功率趋势">
            {dailySummary.length > 0 ? (
              <ReactEChartsCore option={buildSuccessRateOption(dailySummary)} style={{ height: 300 }} />
            ) : (
              <Typography.Text type="secondary">暂无趋势数据</Typography.Text>
            )}
          </Card>
        </Col>
      </Row>

      {/* 最近失败/超时任务 */}
      <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
        <Col span={24}>
          <Card title="最近失败/超时任务">
            {recentFailures.length > 0 ? (
              <Table
                dataSource={recentFailures}
                rowKey="taskId"
                size="small"
                pagination={false}
                columns={[
                  {
                    title: 'TaskId',
                    dataIndex: 'taskId',
                    key: 'taskId',
                    width: 220,
                    ellipsis: true,
                    render: (id: string) => <a onClick={() => navigate(`/tasks/${id}`)}>{id}</a>,
                  },
                  {
                    title: '状态',
                    dataIndex: 'status',
                    key: 'status',
                    width: 120,
                    render: (s: string) => <StatusTag status={s} />,
                  },
                  {
                    title: '模型',
                    dataIndex: 'model',
                    key: 'model',
                    ellipsis: true,
                  },
                  {
                    title: '厂商',
                    dataIndex: 'provider',
                    key: 'provider',
                    width: 130,
                  },
                  {
                    title: '创建时间',
                    dataIndex: 'createdAt',
                    key: 'createdAt',
                    width: 180,
                    render: (t: string) => formatDateTime(t),
                  },
                ]}
              />
            ) : (
              <Typography.Text type="secondary">暂无失败任务</Typography.Text>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
