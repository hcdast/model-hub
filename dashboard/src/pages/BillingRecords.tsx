import { useState, useCallback, useEffect } from 'react';
import {
  Table, Card, Input, Select, DatePicker, Button, Space, Tag, message, Row, Col, Typography, Divider,
} from 'antd';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import PageHeader from '../components/PageHeader';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { billingApi, type BillingRecordQuery, type BillingRecordItem } from '../services/billing';
import { useRequest } from '../hooks/useRequest';
import { formatDateTime } from '../utils/format-helpers';

/** 计费策略选项 */
const BILLING_POLICY_OPTIONS = [
  { label: 'Internal', value: 'internal' },
  { label: 'External', value: 'external' },
];

/** 计费状态选项 */
const STATUS_OPTIONS = [
  { label: '预估', value: 'estimated' },
  { label: '已预扣', value: 'pre_deducted' },
  { label: '已结算', value: 'settled' },
  { label: '已退款', value: 'refunded' },
  { label: '失败', value: 'failed' },
];

/** 计费状态 → 颜色映射 */
const statusColorMap: Record<string, string> = {
  estimated: 'default',
  pre_deducted: 'processing',
  settled: 'success',
  refunded: 'warning',
  failed: 'error',
};

/** 计费状态 → 中文标签映射 */
const statusLabelMap: Record<string, string> = {
  estimated: '预估',
  pre_deducted: '已预扣',
  settled: '已结算',
  refunded: '已退款',
  failed: '失败',
};

/** 计费策略 → 颜色映射 */
const policyColorMap: Record<string, string> = {
  internal: 'blue',
  external: 'green',
};

/** 用量类型 → 中文标签映射 */
const usageTypeLabelMap: Record<string, string> = {
  token: 'Token',
  count: '次数',
  duration: '时长',
};

/**
 * 将计费记录数组导出为 CSV 文件并触发浏览器下载
 */
function exportToCsv(records: BillingRecordItem[]) {
  if (!records.length) {
    message.warning('暂无数据可导出');
    return;
  }

  const headers = [
    'taskId', 'apiKey', 'model', 'provider', 'usageType',
    'estimatedCost', 'actualCost', 'billingPolicy', 'status', 'createdAt',
  ];

  const rows = records.map((r) => [
    r.taskId,
    r.apiKey,
    r.model,
    r.provider,
    r.usageType,
    String(r.estimatedCost ?? ''),
    String(r.actualCost ?? ''),
    r.billingPolicy,
    r.status,
    r.createdAt ? new Date(r.createdAt).toLocaleString('zh-CN') : '',
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
  ].join('\n');

  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `billing-records-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  message.success('导出成功');
}

export default function BillingRecordsPage() {
  const [params, setParams] = useState<BillingRecordQuery>({
    page: 1,
    pageSize: 20,
  });

  const [reconRange, setReconRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(6, 'day').startOf('day'),
    dayjs().endOf('day'),
  ]);
  const [reconRows, setReconRows] = useState<any[]>([]);
  const [reconLoading, setReconLoading] = useState(false);

  const { data, loading, refresh } = useRequest(
    () => billingApi.getRecords(params).then((res: any) => res.data || { items: [], total: 0 }),
    { deps: [params.page, params.pageSize, params.apiKey, params.model, params.billingPolicy, params.status, params.startDate, params.endDate] },
  );

  const loadReconciliation = useCallback(async () => {
    setReconLoading(true);
    try {
      const [from, to] = reconRange;
      const res: any = await billingApi.getSummary({
        groupBy: 'date',
        startDate: from.startOf('day').toISOString(),
        endDate: to.endOf('day').toISOString(),
      });
      setReconRows(Array.isArray(res.data) ? res.data : []);
    } catch {
      message.error('加载对账汇总失败');
      setReconRows([]);
    } finally {
      setReconLoading(false);
    }
  }, [reconRange]);

  useEffect(() => {
    loadReconciliation();
    // 仅首屏按默认日期区间加载；修改区间后请点击「查询对账」
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateFilter = useCallback((patch: Partial<BillingRecordQuery>) => {
    setParams((prev) => ({ ...prev, ...patch, page: 1 }));
  }, []);

  const columns = [
    {
      title: 'Task ID',
      dataIndex: 'taskId',
      key: 'taskId',
      width: 200,
      ellipsis: true,
    },
    {
      title: 'API Key',
      dataIndex: 'apiKey',
      key: 'apiKey',
      width: 160,
      ellipsis: true,
    },
    {
      title: '模型',
      dataIndex: 'model',
      key: 'model',
      width: 160,
      ellipsis: true,
    },
    {
      title: '厂商',
      dataIndex: 'provider',
      key: 'provider',
      width: 120,
    },
    {
      title: '用量类型',
      dataIndex: 'usageType',
      key: 'usageType',
      width: 100,
      render: (v: string) => <Tag>{usageTypeLabelMap[v] || v}</Tag>,
    },
    {
      title: '预估费用',
      dataIndex: 'estimatedCost',
      key: 'estimatedCost',
      width: 110,
      align: 'right' as const,
      render: (v: number) => (v != null ? v.toFixed(2) : '-'),
    },
    {
      title: '实际费用',
      dataIndex: 'actualCost',
      key: 'actualCost',
      width: 110,
      align: 'right' as const,
      render: (v: number) => (v != null ? v.toFixed(2) : '-'),
    },
    {
      title: '计费策略',
      dataIndex: 'billingPolicy',
      key: 'billingPolicy',
      width: 100,
      render: (v: string) => <Tag color={policyColorMap[v] || 'default'}>{v}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (v: string) => (
        <Tag color={statusColorMap[v] || 'default'}>
          {statusLabelMap[v] || v}
        </Tag>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (t: string) => formatDateTime(t),
    },
  ];

  return (
    <div>
      <PageHeader
        title="用量账单"
        extra={(
          <>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => {
                refresh();
                loadReconciliation();
              }}
            >
              刷新全部
            </Button>
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              onClick={() => exportToCsv(data?.items || [])}
            >
              导出 CSV
            </Button>
          </>
        )}
      />

      <Card
        style={{ marginBottom: 16 }}
        loading={reconLoading}
        title="周期对账（按日汇总）"
        extra={(
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            按日聚合用量账单中的预估/实际费用，便于与财务核对
          </Typography.Text>
        )}
      >
        <Row gutter={[12, 12]} align="middle">
          <Col xs={24} md={16} lg={12}>
            <DatePicker.RangePicker
              value={reconRange}
              style={{ width: '100%', maxWidth: 400 }}
              onChange={(v) => v && v[0] && v[1] && setReconRange([v[0], v[1]])}
            />
          </Col>
          <Col>
            <Button type="primary" onClick={() => loadReconciliation()}>
              查询对账
            </Button>
          </Col>
        </Row>
        <Divider style={{ margin: '12px 0' }} />
        <Table
          size="small"
          rowKey={(r) => String(r._id)}
          dataSource={reconRows}
          pagination={false}
          scroll={{ x: 560 }}
          columns={[
            { title: '日期', dataIndex: '_id', width: 120 },
            { title: '笔数', dataIndex: 'count', width: 90, align: 'right' as const },
            {
              title: '预估费用',
              dataIndex: 'totalEstimatedCost',
              align: 'right' as const,
              render: (v: number) => (v != null ? Number(v).toFixed(2) : '—'),
            },
            {
              title: '实际费用',
              dataIndex: 'totalActualCost',
              align: 'right' as const,
              render: (v: number) => (v != null ? Number(v).toFixed(2) : '—'),
            },
          ]}
        />
      </Card>

      <Card title="用量账单明细">
        <Space wrap style={{ marginBottom: 12 }}>
          <Input.Search
            placeholder="API Key"
            allowClear
            style={{ width: 200 }}
            onSearch={(v) => updateFilter({ apiKey: v || undefined })}
          />
          <Input.Search
            placeholder="模型名称"
            allowClear
            style={{ width: 200 }}
            onSearch={(v) => updateFilter({ model: v || undefined })}
          />
          <Select
            placeholder="计费策略"
            allowClear
            style={{ width: 140 }}
            options={BILLING_POLICY_OPTIONS}
            onChange={(v) => updateFilter({ billingPolicy: v })}
          />
          <Select
            placeholder="状态"
            allowClear
            style={{ width: 120 }}
            options={STATUS_OPTIONS}
            onChange={(v) => updateFilter({ status: v })}
          />
          <DatePicker.RangePicker
            onChange={(dates) => {
              updateFilter({
                startDate: dates?.[0]?.toISOString(),
                endDate: dates?.[1]?.toISOString(),
              });
            }}
          />
        </Space>
        <Table
          columns={columns}
          dataSource={data?.items || []}
          rowKey="_id"
          loading={loading}
          size="small"
          scroll={{ x: 1400 }}
          pagination={{
            current: params.page,
            pageSize: params.pageSize,
            total: data?.total || 0,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p, ps) => setParams((prev) => ({ ...prev, page: p, pageSize: ps })),
          }}
        />
      </Card>
    </div>
  );
}
