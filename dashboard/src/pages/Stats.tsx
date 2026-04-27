import { useEffect, useState } from 'react';
import { Table, Card, DatePicker, Select, Space, Typography, Row, Col, Statistic } from 'antd';
import dayjs from 'dayjs';
import { statsApi } from '../services/api';

export default function StatsPage() {
  const [data, setData] = useState<any>({ items: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState<[string, string]>([
    dayjs().subtract(7, 'day').format('YYYY-MM-DD'),
    dayjs().format('YYYY-MM-DD'),
  ]);
  const [featureType, setFeatureType] = useState<string | undefined>();

  const fetchData = async () => {
    setLoading(true);
    try {
      const res: any = await statsApi.daily({ dateFrom: dateRange[0], dateTo: dateRange[1], featureType, pageSize: 100 });
      setData(res.data || { items: [], total: 0 });
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [dateRange, featureType]);

  const summary = data.items.reduce(
    (acc: any, r: any) => ({
      totalCount: acc.totalCount + (r.totalCount || 0),
      successCount: acc.successCount + (r.successCount || 0),
      failedCount: acc.failedCount + (r.failedCount || 0),
    }),
    { totalCount: 0, successCount: 0, failedCount: 0 },
  );

  const columns = [
    { title: '日期', dataIndex: 'date', width: 110 },
    { title: '功能类型', dataIndex: 'featureType', width: 140 },
    { title: '厂商', dataIndex: 'provider', width: 130 },
    { title: '总量', dataIndex: 'totalCount', width: 80, sorter: (a: any, b: any) => a.totalCount - b.totalCount },
    { title: '成功', dataIndex: 'successCount', width: 80 },
    { title: '失败', dataIndex: 'failedCount', width: 80 },
    { title: '成功率', key: 'rate', width: 90, render: (_: any, r: any) => r.totalCount > 0 ? `${((r.successCount / r.totalCount) * 100).toFixed(1)}%` : '-' },
    { title: '平均排队', dataIndex: 'avgQueueWaitMs', width: 100, render: (v: number) => v ? `${Math.round(v)}ms` : '-' },
    { title: '平均处理', dataIndex: 'avgProviderProcessMs', width: 100, render: (v: number) => v ? `${Math.round(v)}ms` : '-' },
    { title: 'P95 E2E', dataIndex: 'p95E2eMs', width: 100, render: (v: number) => v ? `${Math.round(v)}ms` : '-' },
  ];

  return (
    <div>
      <Typography.Title level={4}>统计报表</Typography.Title>

      <Card style={{ marginBottom: 16 }}>
        <Row gutter={24}>
          <Col span={8}><Statistic title="总任务量" value={summary.totalCount} /></Col>
          <Col span={8}><Statistic title="成功" value={summary.successCount} valueStyle={{ color: '#52c41a' }} /></Col>
          <Col span={8}><Statistic title="失败" value={summary.failedCount} valueStyle={{ color: '#ff4d4f' }} /></Col>
        </Row>
      </Card>

      <Card>
        <Space style={{ marginBottom: 16 }} wrap>
          <DatePicker.RangePicker
            value={[dayjs(dateRange[0]), dayjs(dateRange[1])]}
            onChange={(_, ds) => setDateRange([ds[0], ds[1]])}
          />
          <Select
            placeholder="功能类型" allowClear style={{ width: 180 }}
            options={['image_generate', 'image_to_video', 'character_swap', 'video_upscale'].map((v) => ({ label: v, value: v }))}
            onChange={setFeatureType}
          />
        </Space>
        <Table columns={columns} dataSource={data.items} rowKey={(r) => `${r.date}-${r.featureType}-${r.provider}`} loading={loading} size="small" />
      </Card>
    </div>
  );
}
