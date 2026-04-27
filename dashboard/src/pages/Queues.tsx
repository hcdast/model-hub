import { useEffect, useState, useCallback } from 'react';
import { Card, Row, Col, Statistic, Typography, Spin, Tag, Space, Button, Table } from 'antd';
import { ReloadOutlined, DownOutlined, RightOutlined } from '@ant-design/icons';
import { queueApi } from '../services/api';
import dayjs from 'dayjs';

interface QueueJob {
  jobId: string;
  taskId: string | null;
  model: string | null;
  priority: number | null;
  clientId: string | null;
  clientName: string | null;
  enqueuedAt: number | null;
}

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

export default function QueuesPage() {
  const [stats, setStats] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const fetchData = async () => {
    try {
      const res: any = await queueApi.getStats();
      setStats(res.data?.queues || []);
    } catch { /* ignore */ }
    setLoading(false);
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

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '120px auto' }} />;

  const grouped = stats.reduce((acc: Record<string, any[]>, q) => {
    const key = q.featureType || 'other';
    (acc[key] = acc[key] || []).push(q);
    return acc;
  }, {});

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>队列监控</Typography.Title>
        <Button icon={<ReloadOutlined />} onClick={fetchData} size="small">刷新</Button>
        <Tag color="green">每 10 秒自动刷新</Tag>
      </Space>

      {stats.length === 0 && <Card><Typography.Text type="secondary">暂无队列数据</Typography.Text></Card>}

      {Object.entries(grouped).map(([feature, queues]) => (
        <Card key={feature} title={feature} style={{ marginBottom: 16 }} size="small">
          <Row gutter={[16, 16]}>
            {(queues as any[]).map((q) => {
              const isExpanded = expanded.has(q.queueName);
              return (
                <Col key={q.queueName} xs={24} sm={isExpanded ? 24 : 12} lg={isExpanded ? 24 : 8} xl={isExpanded ? 24 : 6}>
                  <Card
                    size="small"
                    hoverable
                    title={
                      <div style={{ cursor: 'pointer' }} onClick={() => toggleExpand(q.queueName)}>
                        <Space>
                          {isExpanded ? <DownOutlined /> : <RightOutlined />}
                          <Tag color="blue">{q.provider || 'all'}</Tag>
                          <span>{q.queueName}</span>
                        </Space>
                      </div>
                    }
                  >
                    <Row gutter={8}>
                      <Col span={isExpanded ? 4 : 12}><Statistic title="等待" value={q.waiting} valueStyle={{ fontSize: 18 }} /></Col>
                      <Col span={isExpanded ? 4 : 12}><Statistic title="处理中" value={q.active} valueStyle={{ fontSize: 18, color: '#1677ff' }} /></Col>
                      <Col span={isExpanded ? 4 : 12}><Statistic title="深度" value={q.depth} valueStyle={{ fontSize: 18, color: q.depth > 100 ? '#ff4d4f' : undefined }} /></Col>
                      <Col span={isExpanded ? 4 : 12}><Statistic title="吞吐/分" value={q.throughputPerMin} precision={1} valueStyle={{ fontSize: 18 }} /></Col>
                      <Col span={isExpanded ? 4 : 12}><Statistic title="已完成" value={q.completed} valueStyle={{ fontSize: 14, color: '#52c41a' }} /></Col>
                      <Col span={isExpanded ? 4 : 12}><Statistic title="失败" value={q.failed} valueStyle={{ fontSize: 14, color: q.failed > 0 ? '#ff4d4f' : undefined }} /></Col>
                    </Row>
                    {isExpanded && <QueueJobList queueName={q.queueName} />}
                  </Card>
                </Col>
              );
            })}
          </Row>
        </Card>
      ))}
    </div>
  );
}
