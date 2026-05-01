import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Card, Row, Col, Statistic, Typography, Spin, Tag, Space, Button,
  Table, Segmented, Tooltip, Badge,
} from 'antd';
import {
  ReloadOutlined, DownOutlined, RightOutlined,
  ClockCircleOutlined, ThunderboltOutlined,
  CheckCircleOutlined, CloseCircleOutlined,
  AppstoreOutlined, UnorderedListOutlined,
  DashboardOutlined,
} from '@ant-design/icons';
import { queueApi } from '../services/api';
import StatCard from '../components/StatCard';
import dayjs from 'dayjs';

/* ---------- 类型定义 ---------- */

interface QueueStat {
  queueName: string;
  featureType?: string;
  provider?: string;
  waiting: number;
  active: number;
  depth: number;
  throughputPerMin: number;
  completed: number;
  failed: number;
}

interface QueueJob {
  jobId: string;
  taskId: string | null;
  model: string | null;
  priority: number | null;
  clientId: string | null;
  clientName: string | null;
  enqueuedAt: number | null;
}

/* ---------- 健康状态工具函数 ---------- */

type HealthLevel = 'error' | 'warning' | 'active' | 'idle';

/** 根据队列指标判断健康等级 */
function getHealthLevel(q: QueueStat): HealthLevel {
  if (q.failed > 0) return 'error';
  if (q.depth > 100) return 'warning';
  if (q.active > 0 || q.waiting > 0) return 'active';
  return 'idle';
}

const healthMeta: Record<HealthLevel, { color: string; label: string; border: string }> = {
  error:   { color: 'error',      label: '异常', border: '#ff4d4f' },
  warning: { color: 'warning',    label: '积压', border: '#faad14' },
  active:  { color: 'processing', label: '运行中', border: '#1677ff' },
  idle:    { color: 'default',    label: '空闲', border: '#d9d9d9' },
};

/** 健康状态标签 */
function HealthTag({ queue }: { queue: QueueStat }) {
  const level = getHealthLevel(queue);
  const meta = healthMeta[level];
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

/** 卡片左边框样式 */
function cardBorderStyle(q: QueueStat): React.CSSProperties {
  return { borderLeft: `3px solid ${healthMeta[getHealthLevel(q)].border}` };
}

/* ---------- 任务列表子组件 ---------- */

const jobColumns = [
  { title: 'Task ID', dataIndex: 'taskId', key: 'taskId', ellipsis: true, width: 200 },
  { title: '模型', dataIndex: 'model', key: 'model', ellipsis: true, width: 160 },
  {
    title: '优先级', dataIndex: 'priority', key: 'priority', width: 80,
    render: (v: number | null) => v ?? '-',
  },
  { title: '客户端', dataIndex: 'clientName', key: 'clientName', width: 120, render: (v: string | null) => v || '-' },
  {
    title: '入队时间', dataIndex: 'enqueuedAt', key: 'enqueuedAt', width: 170,
    render: (v: number | null) => v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-',
  },
];

function QueueJobList({ queueName }: { queueName: string }) {
  const [jobs, setJobs] = useState<QueueJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'waiting' | 'active'>('waiting');

  const fetchJobs = useCallback(async () => {
    try {
      const res: any = await queueApi.getJobs(queueName, { status: tab, page: 1, pageSize: 50 });
      setJobs(res.data?.items || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [queueName, tab]);

  useEffect(() => {
    setLoading(true);
    fetchJobs();
    const timer = setInterval(fetchJobs, 10000);
    return () => clearInterval(timer);
  }, [fetchJobs]);

  return (
    <div style={{ marginTop: 8 }}>
      <Space style={{ marginBottom: 8 }}>
        <Button size="small" type={tab === 'waiting' ? 'primary' : 'default'} onClick={() => setTab('waiting')}>等待中</Button>
        <Button size="small" type={tab === 'active' ? 'primary' : 'default'} onClick={() => setTab('active')}>处理中</Button>
      </Space>
      <Table
        dataSource={jobs}
        columns={jobColumns}
        rowKey="jobId"
        size="small"
        loading={loading}
        pagination={false}
        locale={{ emptyText: '暂无任务' }}
      />
    </div>
  );
}

/* ---------- 卡片视图 ---------- */

function QueueCardView({
  queues, expanded, toggleExpand,
}: {
  queues: QueueStat[];
  expanded: Set<string>;
  toggleExpand: (name: string) => void;
}) {
  return (
    <Row gutter={[12, 12]}>
      {queues.map((q) => {
        const isExpanded = expanded.has(q.queueName);
        return (
          <Col key={q.queueName} xs={24} sm={isExpanded ? 24 : 12} lg={isExpanded ? 24 : 8} xl={isExpanded ? 24 : 6}>
            <Card
              size="small"
              hoverable
              style={cardBorderStyle(q)}
              title={
                <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => toggleExpand(q.queueName)}>
                  {isExpanded ? <DownOutlined style={{ fontSize: 10 }} /> : <RightOutlined style={{ fontSize: 10 }} />}
                  <Tag color="blue" style={{ marginRight: 0 }}>{q.provider || 'all'}</Tag>
                  <Typography.Text ellipsis style={{ flex: 1, fontSize: 13 }}>{q.queueName}</Typography.Text>
                  <HealthTag queue={q} />
                </div>
              }
            >
              <Row gutter={8}>
                <Col span={isExpanded ? 4 : 12}>
                  <Statistic title="等待" value={q.waiting} valueStyle={{ fontSize: 16 }} />
                </Col>
                <Col span={isExpanded ? 4 : 12}>
                  <Statistic title="处理中" value={q.active} valueStyle={{ fontSize: 16, color: '#1677ff' }} />
                </Col>
                <Col span={isExpanded ? 4 : 12}>
                  <Statistic title="深度" value={q.depth} valueStyle={{ fontSize: 16, color: q.depth > 100 ? '#ff4d4f' : undefined }} />
                </Col>
                <Col span={isExpanded ? 4 : 12}>
                  <Statistic title="吞吐/分" value={q.throughputPerMin} precision={1} valueStyle={{ fontSize: 16 }} />
                </Col>
                <Col span={isExpanded ? 4 : 12}>
                  <Statistic title="已完成" value={q.completed} valueStyle={{ fontSize: 13, color: '#52c41a' }} />
                </Col>
                <Col span={isExpanded ? 4 : 12}>
                  <Statistic title="失败" value={q.failed} valueStyle={{ fontSize: 13, color: q.failed > 0 ? '#ff4d4f' : undefined }} />
                </Col>
              </Row>
              {isExpanded && <QueueJobList queueName={q.queueName} />}
            </Card>
          </Col>
        );
      })}
    </Row>
  );
}

/* ---------- 表格视图 ---------- */

function QueueTableView({
  queues, expanded, toggleExpand,
}: {
  queues: QueueStat[];
  expanded: Set<string>;
  toggleExpand: (name: string) => void;
}) {
  const columns = [
    {
      title: '队列', dataIndex: 'queueName', key: 'queueName', ellipsis: true,
      render: (name: string, q: QueueStat) => (
        <Space>
          <span style={{ cursor: 'pointer', color: '#1677ff' }} onClick={() => toggleExpand(name)}>
            {expanded.has(name) ? <DownOutlined style={{ fontSize: 10 }} /> : <RightOutlined style={{ fontSize: 10 }} />}
          </span>
          <Tag color="blue">{q.provider || 'all'}</Tag>
          <Typography.Text
            style={{ cursor: 'pointer' }}
            onClick={() => toggleExpand(name)}
          >
            {name}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '等待', dataIndex: 'waiting', key: 'waiting', width: 80, align: 'right' as const,
      sorter: (a: QueueStat, b: QueueStat) => a.waiting - b.waiting,
    },
    {
      title: '处理中', dataIndex: 'active', key: 'active', width: 80, align: 'right' as const,
      render: (v: number) => <span style={{ color: v > 0 ? '#1677ff' : undefined }}>{v}</span>,
      sorter: (a: QueueStat, b: QueueStat) => a.active - b.active,
    },
    {
      title: '深度', dataIndex: 'depth', key: 'depth', width: 80, align: 'right' as const,
      render: (v: number) => <span style={{ color: v > 100 ? '#ff4d4f' : undefined }}>{v}</span>,
      sorter: (a: QueueStat, b: QueueStat) => a.depth - b.depth,
    },
    {
      title: '吞吐/分', dataIndex: 'throughputPerMin', key: 'throughputPerMin', width: 90, align: 'right' as const,
      render: (v: number) => v?.toFixed(1) ?? '0.0',
      sorter: (a: QueueStat, b: QueueStat) => a.throughputPerMin - b.throughputPerMin,
    },
    {
      title: '已完成', dataIndex: 'completed', key: 'completed', width: 80, align: 'right' as const,
      render: (v: number) => <span style={{ color: '#52c41a' }}>{v}</span>,
      sorter: (a: QueueStat, b: QueueStat) => a.completed - b.completed,
    },
    {
      title: '失败', dataIndex: 'failed', key: 'failed', width: 80, align: 'right' as const,
      render: (v: number) => <span style={{ color: v > 0 ? '#ff4d4f' : undefined }}>{v}</span>,
      sorter: (a: QueueStat, b: QueueStat) => a.failed - b.failed,
    },
    {
      title: '状态', key: 'health', width: 90, align: 'center' as const,
      render: (_: unknown, q: QueueStat) => <HealthTag queue={q} />,
      filters: [
        { text: '异常', value: 'error' },
        { text: '积压', value: 'warning' },
        { text: '运行中', value: 'active' },
        { text: '空闲', value: 'idle' },
      ],
      onFilter: (value: any, q: QueueStat) => getHealthLevel(q) === value,
    },
  ];

  return (
    <Table
      dataSource={queues}
      columns={columns}
      rowKey="queueName"
      size="small"
      pagination={false}
      expandable={{
        expandedRowKeys: Array.from(expanded),
        onExpand: (_, record) => toggleExpand(record.queueName),
        expandedRowRender: (record) => <QueueJobList queueName={record.queueName} />,
        expandIcon: () => null, // 用队列名前的箭头控制展开
      }}
    />
  );
}


/* ---------- 主页面 ---------- */

export default function QueuesPage() {
  const [stats, setStats] = useState<QueueStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  /** 视图模式：card 卡片 / table 表格 */
  const [viewMode, setViewMode] = useState<'card' | 'table'>('card');
  /** 按分组折叠空闲队列 */
  const [collapsedIdle, setCollapsedIdle] = useState<Set<string>>(new Set());
  /** 折叠的分组 */
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const fetchData = async () => {
    try {
      const res: any = await queueApi.getStats();
      setStats(res.data?.queues || []);
    } catch { /* ignore */ }
    setLoading(false);
    setLastUpdated(new Date());
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, 10000);
    return () => clearInterval(timer);
  }, []);

  const toggleExpand = (queueName: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(queueName)) next.delete(queueName);
      else next.add(queueName);
      return next;
    });
  };

  const toggleGroup = (group: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const toggleIdleVisibility = (group: string) => {
    setCollapsedIdle((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  /* ---------- 汇总指标 ---------- */

  const summary = useMemo(() => {
    return stats.reduce(
      (acc, q) => ({
        waiting: acc.waiting + q.waiting,
        active: acc.active + q.active,
        depth: acc.depth + q.depth,
        throughput: acc.throughput + q.throughputPerMin,
        completed: acc.completed + q.completed,
        failed: acc.failed + q.failed,
        errorCount: acc.errorCount + (q.failed > 0 ? 1 : 0),
        warningCount: acc.warningCount + (q.depth > 100 ? 1 : 0),
      }),
      { waiting: 0, active: 0, depth: 0, throughput: 0, completed: 0, failed: 0, errorCount: 0, warningCount: 0 },
    );
  }, [stats]);

  /* ---------- 按 featureType 分组 ---------- */

  const grouped = useMemo(() => {
    return stats.reduce((acc: Record<string, QueueStat[]>, q) => {
      const key = q.featureType || 'other';
      (acc[key] = acc[key] || []).push(q);
      return acc;
    }, {});
  }, [stats]);

  /* ---------- 渲染 ---------- */

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '120px auto' }} />;

  return (
    <div>
      {/* ===== 页面头部 ===== */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <Space align="center">
          <DashboardOutlined style={{ fontSize: 22, color: '#1677ff' }} />
          <Typography.Title level={4} style={{ margin: 0 }}>队列监控</Typography.Title>
          <Badge status={summary.errorCount > 0 ? 'error' : summary.warningCount > 0 ? 'warning' : 'success'} />
        </Space>
        <Space wrap>
          {lastUpdated && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              最后更新：{lastUpdated.toLocaleTimeString('zh-CN')}
            </Typography.Text>
          )}
          <Button icon={<ReloadOutlined />} loading={refreshing} onClick={handleRefresh} size="small">
            刷新
          </Button>
          <Tag color="green">每 10 秒自动刷新</Tag>
          <Segmented
            size="small"
            value={viewMode}
            onChange={(v) => setViewMode(v as 'card' | 'table')}
            options={[
              { label: <Tooltip title="卡片视图"><AppstoreOutlined /></Tooltip>, value: 'card' },
              { label: <Tooltip title="表格视图"><UnorderedListOutlined /></Tooltip>, value: 'table' },
            ]}
          />
        </Space>
      </div>

      {/* ===== 全局汇总指标 ===== */}
      <Row gutter={[12, 12]} style={{ marginBottom: 24 }}>
        <Col xs={12} sm={8} lg={4}>
          <StatCard
            title="总等待数"
            value={summary.waiting}
            prefix={<ClockCircleOutlined />}
            valueStyle={{ color: summary.waiting > 50 ? '#ff4d4f' : undefined }}
          />
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <StatCard
            title="总处理中"
            value={summary.active}
            prefix={<ThunderboltOutlined />}
            valueStyle={{ color: '#1677ff' }}
          />
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <StatCard
            title="总队列深度"
            value={summary.depth}
            prefix={<DashboardOutlined />}
            valueStyle={{ color: summary.depth > 100 ? '#ff4d4f' : undefined }}
          />
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <StatCard
            title="总吞吐/分"
            value={summary.throughput}
            precision={1}
            prefix={<ThunderboltOutlined />}
          />
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <StatCard
            title="总已完成"
            value={summary.completed}
            prefix={<CheckCircleOutlined />}
            valueStyle={{ color: '#52c41a' }}
          />
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <StatCard
            title="总失败"
            value={summary.failed}
            prefix={<CloseCircleOutlined />}
            valueStyle={{ color: summary.failed > 0 ? '#ff4d4f' : undefined }}
          />
        </Col>
      </Row>

      {/* ===== 空状态 ===== */}
      {stats.length === 0 && (
        <Card>
          <Typography.Text type="secondary">暂无队列数据</Typography.Text>
        </Card>
      )}

      {/* ===== 按分组渲染队列 ===== */}
      {Object.entries(grouped).map(([feature, queues]) => {
        const isGroupCollapsed = collapsedGroups.has(feature);
        const showIdle = !collapsedIdle.has(feature);

        // 分组汇总
        const groupSummary = (queues as QueueStat[]).reduce(
          (acc, q) => ({
            waiting: acc.waiting + q.waiting,
            active: acc.active + q.active,
            failed: acc.failed + q.failed,
          }),
          { waiting: 0, active: 0, failed: 0 },
        );

        // 活跃队列 vs 空闲队列
        const activeQueues = (queues as QueueStat[]).filter(
          (q) => q.waiting > 0 || q.active > 0 || q.failed > 0 || q.depth > 0,
        );
        const idleQueues = (queues as QueueStat[]).filter(
          (q) => q.waiting === 0 && q.active === 0 && q.failed === 0 && q.depth === 0,
        );

        // 当前要展示的队列
        const visibleQueues = showIdle ? (queues as QueueStat[]) : activeQueues;

        return (
          <Card
            key={feature}
            style={{ marginBottom: 16 }}
            size="small"
            title={
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flexWrap: 'wrap' }}
                onClick={() => toggleGroup(feature)}
              >
                {isGroupCollapsed ? <RightOutlined style={{ fontSize: 10 }} /> : <DownOutlined style={{ fontSize: 10 }} />}
                <Typography.Text strong style={{ fontSize: 14 }}>{feature}</Typography.Text>
                <Tag>{(queues as QueueStat[]).length} 个队列</Tag>
                {groupSummary.active > 0 && <Tag color="processing">{groupSummary.active} 处理中</Tag>}
                {groupSummary.waiting > 0 && <Tag color="warning">{groupSummary.waiting} 等待中</Tag>}
                {groupSummary.failed > 0 && <Tag color="error">{groupSummary.failed} 失败</Tag>}
                {groupSummary.waiting === 0 && groupSummary.active === 0 && groupSummary.failed === 0 && (
                  <Tag color="success">全部空闲</Tag>
                )}
              </div>
            }
          >
            {!isGroupCollapsed && (
              <>
                {viewMode === 'card' ? (
                  <QueueCardView queues={visibleQueues} expanded={expanded} toggleExpand={toggleExpand} />
                ) : (
                  <QueueTableView queues={visibleQueues} expanded={expanded} toggleExpand={toggleExpand} />
                )}

                {/* 空闲队列折叠提示 */}
                {idleQueues.length > 0 && activeQueues.length > 0 && (
                  <div style={{ marginTop: 12, textAlign: 'center' }}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      另有 {idleQueues.length} 个空闲队列
                    </Typography.Text>
                    <Button
                      type="link"
                      size="small"
                      onClick={() => toggleIdleVisibility(feature)}
                    >
                      {showIdle ? '隐藏空闲' : '显示全部'}
                    </Button>
                  </div>
                )}
              </>
            )}
          </Card>
        );
      })}
    </div>
  );
}
