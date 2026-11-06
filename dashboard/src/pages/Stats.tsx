import Table from '../components/AdminTable';
import ProviderSelect from '../components/ProviderSelect';
import { useSearchParams } from 'react-router-dom';
import { useRequest } from '../hooks/useRequest';
import { MODEL_CONFIG_MODEL_TYPES } from '../constants/model-config-model-type';
import { useEffect, useState, useMemo } from 'react';
import { Card, DatePicker, Select, Button, Typography, Row, Col, Statistic, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import PageHeader from '../components/PageHeader';
import dayjs from 'dayjs';
import ReactEChartsCore from '../components/Chart';
import { statsApi } from '../services/api';
import { aggregateDailySummary, buildTaskVolumeOption } from '../utils/trend-chart-helpers';
import RequestFeedback from '../components/RequestFeedback';

export default function StatsPage() {
  const [search, setSearch] = useSearchParams();
  const page = Number(search.get('page')) || 1, featureType = search.get('featureType') || undefined, provider = search.get('provider') || undefined;
  const dateRange: [string, string] = [search.get('dateFrom') || dayjs().subtract(7, 'day').format('YYYY-MM-DD'), search.get('dateTo') || dayjs().format('YYYY-MM-DD')];
  const update = (patch: Record<string, any>) => { const next = new URLSearchParams(search); Object.entries({ page: 1, ...patch } as Record<string, any>).forEach(([k,v]) => v === undefined || v === '' ? next.delete(k) : next.set(k, String(v))); setSearch(next); };
  const { data = { items: [], total: 0 }, error, lastSuccess, loading, refresh: fetchData } = useRequest<any>(async () => (await statsApi.daily({ dateFrom: dateRange[0], dateTo: dateRange[1], featureType, provider, page, pageSize: 20 }) as any).data, { deps: [search.toString()] });
  // 按日期聚合趋势数据
  const dailySummary = useMemo(() => data.trend || aggregateDailySummary(data.items), [data.items, data.trend]);

  const featureTypeOptions = [...MODEL_CONFIG_MODEL_TYPES, 'image_generate', 'image_to_video', 'text_to_video', 'character_swap', 'head_swap', 'video_upscale'];

  const summary = data.summary || data.items.reduce(
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
    { title: '模型', dataIndex: 'model', width: 180, ellipsis: true },
    { title: '厂商', dataIndex: 'provider', width: 130 },
    { title: '总量', dataIndex: 'totalCount', width: 80, sorter: (a: any, b: any) => a.totalCount - b.totalCount },
    { title: '成功', dataIndex: 'successCount', width: 80 },
    { title: '失败', dataIndex: 'failedCount', width: 80 },
    { title: '成功率', key: 'rate', width: 90, render: (_: any, r: any) => r.totalCount > 0 ? `${((r.successCount / r.totalCount) * 100).toFixed(1)}%` : '-' },
    { title: '平均排队', dataIndex: 'avgQueueWaitMs', width: 100, render: (v: number) => v ? `${Math.round(v)}ms` : '-' },
    { title: '平均处理', dataIndex: 'avgProviderProcessMs', width: 100, render: (v: number) => v ? `${Math.round(v)}ms` : '-' },
    { title: '平均端到端', dataIndex: 'avgTotalE2eMs', width: 100, render: (v: number) => v ? `${Math.round(v)}ms` : '-' },
  ];

  return (
    <div>
      <PageHeader
        title="统计报表"
        extra={(
          <>
            <DatePicker.RangePicker
              value={[dayjs(dateRange[0]), dayjs(dateRange[1])]}
              onChange={(_, ds) => ds[0] && ds[1] && update({ dateFrom: ds[0], dateTo: ds[1] })}
            />
            <ProviderSelect value={provider} onChange={v => update({ provider: v })} style={{ width: 150 }} />
            <Select
              placeholder="功能类型"
              allowClear
              style={{ width: 180 }}
              options={featureTypeOptions.map((v: string) => ({ label: v, value: v }))}
              value={featureType}
              onChange={(v) => update({ featureType: v })}
            />
            <Button type="primary" icon={<ReloadOutlined />} onClick={() => void fetchData()}>
              刷新
            </Button>
          </>
        )}
      />

      <Typography.Paragraph type="secondary">实时任务数据 · UTC 日期 · 汇总覆盖全部筛选结果 · 更新时间：{data.generatedAt ? new Date(data.generatedAt).toLocaleString() : "—"}</Typography.Paragraph>
      <RequestFeedback error={error} hasData={!!lastSuccess} retry={fetchData} />
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={24}>
          <Col span={8}><Statistic title="总任务量" value={error && !lastSuccess ? '—' : summary.totalCount} /></Col>
          <Col span={8}><Statistic title="成功" value={error && !lastSuccess ? '—' : summary.successCount} valueStyle={{ color: '#52c41a' }} /></Col>
          <Col span={8}><Statistic title="失败" value={error && !lastSuccess ? '—' : summary.failedCount} valueStyle={{ color: '#ff4d4f' }} /></Col>
        </Row>
      </Card>

      {/* 趋势折线图 */}
      <Card title="趋势图" style={{ marginBottom: 16 }}>
        {dailySummary.length > 0 ? (
          <ReactEChartsCore option={buildTaskVolumeOption(dailySummary)} style={{ height: 300 }} />
        ) : (
          <Typography.Text type="secondary">暂无趋势数据</Typography.Text>
        )}
      </Card>

      <Card>
        <Table columns={columns} dataSource={data.items} rowKey={(r) => `${r.date}-${r.featureType}-${r.provider}-${r.model}`} pagination={{ current: page, pageSize: 20, total: data.total, onChange: (p) => update({ page: p }), showSizeChanger: false }} loading={loading} size="small" />
      </Card>
    </div>
  );
}
