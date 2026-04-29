import { useEffect, useState } from 'react';
import { Row, Col, Card, Typography, Spin } from 'antd';
import {
  CheckCircleOutlined, CloseCircleOutlined,
  CloudServerOutlined, ThunderboltOutlined,
  ClockCircleOutlined, StopOutlined,
} from '@ant-design/icons';
import StatCard from '../components/StatCard';
import { overviewApi } from '../services/api';

export default function DashboardPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const res: any = await overviewApi.getOverview();
      setData(res.data);
    } catch { /* ignore */ }
    setLoading(false);
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
      <Typography.Title level={4} style={{ marginBottom: 24 }}>Dashboard 总览</Typography.Title>

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
          <Card title="队列状态">
            <Row gutter={16}>
              <Col span={12}><StatCard title="等待+延迟" value={queues.totalDepth || 0} /></Col>
              <Col span={12}><StatCard title="处理中" value={queues.totalActive || 0} /></Col>
            </Row>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
