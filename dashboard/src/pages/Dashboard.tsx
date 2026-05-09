import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Row, Col, Card, Typography, Spin, Table, Button, Space, Tag, Badge, Statistic, Alert } from 'antd';
import {
  CheckCircleOutlined,
  CloudServerOutlined, ThunderboltOutlined,
  ClockCircleOutlined,
  ReloadOutlined,
  DollarOutlined, StarOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import ReactEChartsCore from 'echarts-for-react';
import StatCard from '../components/StatCard';
import StatusTag from '../components/StatusTag';
import PageHeader from '../components/PageHeader';
import { overviewApi, statsApi, taskApi } from '../services/api';
import { formatDateTime } from '../utils/format-helpers';
import { usePermission } from '../hooks/usePermission';
import {
  aggregateDailySummary,
  buildTaskVolumeOption,
  buildSuccessRateOption,
  DailySummary,
} from '../utils/trend-chart-helpers';

export default function DashboardPage() {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const canStats = hasPermission('stats:read');
  const canTask = hasPermission('task:read');

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [dailySummary, setDailySummary] = useState<DailySummary[]>([]);
  const [recentFailures, setRecentFailures] = useState<any[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [costData, setCostData] = useState<any>(null);
  const [statsError, setStatsError] = useState(false);
  const [taskError, setTaskError] = useState(false);

  const fetchData = useCallback(async () => {
    setStatsError(false);
    setTaskError(false);

    if (canStats) {
      try {
        const res: any = await overviewApi.getOverview();
        setData(res.data);
      } catch {
        setData(null);
        setStatsError(true);
      }
      try {
        const costRes: any = await overviewApi.getCostOverview();
        setCostData(costRes.data);
      } catch {
        setCostData(null);
      }
      try {
        const dateTo = dayjs().format('YYYY-MM-DD');
        const dateFrom = dayjs().subtract(6, 'day').format('YYYY-MM-DD');
        const statsRes: any = await statsApi.daily({ dateFrom, dateTo, pageSize: 100 });
        const records = statsRes.data?.items || statsRes.data || [];
        setDailySummary(aggregateDailySummary(records));
      } catch {
        setDailySummary([]);
      }
    } else {
      setData(null);
      setCostData(null);
      setDailySummary([]);
    }

    if (canTask) {
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
      } catch {
        setRecentFailures([]);
        setTaskError(true);
      }
    } else {
      setRecentFailures([]);
    }

    setLoading(false);
    setLastUpdated(new Date());
  }, [canStats, canTask]);

  const handleManualRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  useEffect(() => {
    setLoading(true);
    void fetchData();
    const timer = setInterval(() => void fetchData(), 30000);
    return () => clearInterval(timer);
  }, [fetchData]);

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '120px auto' }} />;

  const today = data?.today || {};
  const total = data?.total || {};
  const queues = data?.queues || {};
  const showNoAccessHint = !canStats && !canTask;

  return (
    <div>
      <PageHeader
        title="Dashboard 总览"
        extra={(
          <Space>
            {lastUpdated && (
              <Typography.Text type="secondary">
                最后更新：{lastUpdated.toLocaleTimeString('zh-CN')}
              </Typography.Text>
            )}
            <Button icon={<ReloadOutlined />} loading={refreshing} onClick={handleManualRefresh}>
              刷新
            </Button>
          </Space>
        )}
      />

      {showNoAccessHint && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="当前账号无可用的总览数据权限"
          description={(
            <span>
              联系管理员授予 <Typography.Text code>stats:read</Typography.Text>（指标与成本）和/或
              <Typography.Text code>task:read</Typography.Text>（最近失败任务）。
            </span>
          )}
        />
      )}

      {canStats && statsError && (
        <Alert
          type="error"
          showIcon
          closable
          style={{ marginBottom: 16 }}
          message="总览数据加载失败"
          description="请检查网络或稍后点击刷新；若持续失败，确认您仍拥有 stats:read 权限。"
        />
      )}

      {canTask && taskError && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="最近失败任务列表加载失败"
        />
      )}

      {/* 成本观测 — 依赖 stats:read 接口 */}
      {canStats && (
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
      )}

      {canStats && (
        <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
          <Col xs={24} lg={8}>
            <Card title={<>今日任务 <CloudServerOutlined /></>}>
              <Row gutter={[16, 16]}>
                <Col xs={12}>
                  <Statistic title="任务总量" value={today.totalTasks || 0} />
                </Col>
                <Col xs={12}>
                  <Statistic
                    title="成功率"
                    value={today.successRate?.toFixed(1) || '0.0'}
                    suffix="%"
                    prefix={<CheckCircleOutlined />}
                    valueStyle={{ color: (today.successRate || 0) >= 95 ? '#52c41a' : '#faad14' }}
                  />
                </Col>
              </Row>
              <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>
                成功 <Typography.Text style={{ color: '#52c41a' }}>{today.successTasks || 0}</Typography.Text>
                {' · '}
                失败 <Typography.Text style={{ color: '#ff4d4f' }}>{today.failedTasks || 0}</Typography.Text>
                {' · '}
                超时 <Typography.Text style={{ color: '#faad14' }}>{today.timeoutTasks || 0}</Typography.Text>
              </Typography.Paragraph>
            </Card>
          </Col>
          <Col xs={24} lg={8}>
            <Card title={<>累计任务 <CloudServerOutlined /></>}>
              <Row gutter={[16, 16]}>
                <Col xs={12}>
                  <Statistic title="任务总量" value={total.totalTasks || 0} />
                </Col>
                <Col xs={12}>
                  <Statistic
                    title="成功率"
                    value={total.successRate?.toFixed(1) || '0.0'}
                    suffix="%"
                    prefix={<CheckCircleOutlined />}
                    valueStyle={{ color: (total.successRate || 0) >= 95 ? '#52c41a' : '#faad14' }}
                  />
                </Col>
              </Row>
              <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>
                成功 <Typography.Text style={{ color: '#52c41a' }}>{total.successTasks || 0}</Typography.Text>
                {' · '}
                失败 <Typography.Text style={{ color: '#ff4d4f' }}>{total.failedTasks || 0}</Typography.Text>
                {' · '}
                超时 <Typography.Text style={{ color: '#faad14' }}>{total.timeoutTasks || 0}</Typography.Text>
              </Typography.Paragraph>
            </Card>
          </Col>
          <Col xs={24} lg={8}>
            <Card
              title={(
                <span>
                  队列状态
                  <ThunderboltOutlined style={{ marginLeft: 6 }} />
                  {(queues.totalDepth || 0) > 50 && (
                    <Badge status="error" style={{ marginLeft: 8 }} />
                  )}
                </span>
              )}
              style={(queues.totalDepth || 0) > 100 ? { borderLeft: '3px solid #ff4d4f' } : undefined}
            >
              <Row gutter={[16, 16]}>
                <Col xs={12}>
                  <Statistic
                    title="等待 + 延迟（深度）"
                    value={queues.totalDepth || 0}
                    valueStyle={{ color: (queues.totalDepth || 0) > 100 ? '#ff4d4f' : undefined }}
                  />
                </Col>
                <Col xs={12}>
                  <Statistic
                    title="处理中"
                    value={queues.totalActive || 0}
                    prefix={<ClockCircleOutlined />}
                  />
                </Col>
              </Row>
              <div style={{ marginTop: 12, textAlign: 'center' }}>
                {(queues.totalDepth || 0) <= 50 && <Tag color="success">健康</Tag>}
                {(queues.totalDepth || 0) > 50 && (queues.totalDepth || 0) <= 100 && <Tag color="warning">注意</Tag>}
                {(queues.totalDepth || 0) > 100 && <Tag color="error">告警</Tag>}
              </div>
            </Card>
          </Col>
        </Row>
      )}

      {canStats && (
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
      )}

      {canTask && (
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
      )}
    </div>
  );
}
