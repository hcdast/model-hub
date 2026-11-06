import Table from '../components/AdminTable';
import { useState, useCallback, useEffect } from 'react';
import { Card, Input, Select, DatePicker, Button, Space, Tag, message, Row, Col, Typography, Divider,
} from 'antd';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import { useSearchParams, Link } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { billingApi, type BillingRecordQuery, type BillingRecordItem } from '../services/billing';
import { useRequest } from '../hooks/useRequest';
import { formatDateTime } from '../utils/format-helpers';
import RequestFeedback from '../components/RequestFeedback';

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
    'taskId', 'clientName', 'model', 'provider', 'usageType',
    'estimatedCost', 'actualCost', 'currency', 'billingPolicy', 'status', 'createdAt_UTC',
  ];

  const rows = records.map((r) => [
    r.taskId,
    (r as any).clientName || r.apiKey,
    r.model,
    r.provider,
    r.usageType,
    String(r.estimatedCost ?? ''),
    String(r.actualCost ?? ''),
    r.currency,
    r.billingPolicy,
    r.status,
    r.createdAt ? new Date(r.createdAt).toISOString() : '',
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/^[\s]*[=+@-]/, m => `'${m}`).replace(/"/g, '""')}"`).join(',')),
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
  const [exporting, setExporting] = useState(false);
  const [search, setSearch] = useSearchParams();
  const params: BillingRecordQuery = { ...Object.fromEntries(search), page: Number(search.get('page')) || 1, pageSize: Number(search.get('pageSize')) || 20 } as BillingRecordQuery;
  const setParams = (update: BillingRecordQuery | ((prev: BillingRecordQuery) => BillingRecordQuery)) => { const next = typeof update === 'function' ? update(params) : update; setSearch(Object.fromEntries(Object.entries(next).filter(([,v]) => v !== undefined && v !== '').map(([k,v]) => [k, String(v)])), { replace: true }); };

  const exportAll = async () => {
    setExporting(true);
    try {
      const res: any = await billingApi.exportRecords(params);
      const url = URL.createObjectURL(new Blob([res.data.csv], { type: 'text/csv;charset=utf-8;' }));
      const a = document.createElement('a'); a.href = url; a.download = `billing-records-all-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      message.success(`已导出全部筛选结果 ${res.data.total} 条（UTC）`);
    } catch (e: any) { message.error(e.response?.data?.message || e.message || '导出失败'); }
    finally { setExporting(false); }
  };
  const [reconRange, setReconRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(6, 'day').startOf('day'),
    dayjs().endOf('day'),
  ]);
  const [reconRows, setReconRows] = useState<any[]>([]);
  const [reconLoading, setReconLoading] = useState(false);

  const { data, error, loading, refresh } = useRequest(
    () => billingApi.getRecords(params).then((res: any) => res.data || { items: [], total: 0 }),
    { deps: [params.taskId, params.page, params.pageSize, params.apiKey, params.model, params.billingPolicy, params.status, params.startDate, params.endDate] },
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

  const updateFilter = (patch: Partial<BillingRecordQuery>) => {
    setParams((prev) => ({ ...prev, ...patch, page: 1 }));
  };

  const columns = [
    {
      title: 'Task ID',
      dataIndex: 'taskId',
      key: 'taskId',
      render: (id: string) => <Link to={`/tasks/${encodeURIComponent(id)}`}>{id}</Link>,
      width: 200,
      ellipsis: true,
    },
    {
      title: '客户端',
      key: 'clientName',
      width: 220,
      render: (_: unknown, row: BillingRecordItem) => <Space direction="vertical" size={0}><span>{row.clientName || '历史客户端'}</span><Typography.Text type="secondary">{row.apiKey}</Typography.Text>{row.clientRef && <Typography.Text copyable style={{ fontSize: 11 }}>{row.clientRef}</Typography.Text>}</Space>,
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
      title: '币种', dataIndex: 'currency', key: 'currency', width: 85,
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
            <Input.Search key={`taskId:${params.taskId || ''}`} placeholder="任务 ID 精确查询" defaultValue={params.taskId} allowClear style={{ width: 220 }} onSearch={taskId => setParams({ ...params, taskId, page: 1 })} />
            <Button
              icon={<ReloadOutlined />}
              onClick={() => {
                refresh();
                loadReconciliation();
              }}
            >
              刷新全部
            </Button>
            <Button loading={exporting} onClick={exportAll}>导出全部筛选结果 CSV</Button>
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              onClick={() => exportToCsv(data?.items || [])}
            >
              导出当前页 CSV
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
        <RequestFeedback error={error} hasData={!!data} retry={refresh} />
        <Space wrap style={{ marginBottom: 12 }}>
          <Input.Search
            key={`apiKey:${params.apiKey || ''}`}
            defaultValue={params.apiKey}
            placeholder="API Key"
            allowClear
            style={{ width: 200 }}
            onSearch={(v) => updateFilter({ apiKey: v || undefined })}
          />
          <Input.Search
            key={`model:${params.model || ''}`}
            defaultValue={params.model}
            placeholder="模型名称"
            allowClear
            style={{ width: 200 }}
            onSearch={(v) => updateFilter({ model: v || undefined })}
          />
          <Select
            value={params.billingPolicy}
            placeholder="计费策略"
            allowClear
            style={{ width: 140 }}
            options={BILLING_POLICY_OPTIONS}
            onChange={(v) => updateFilter({ billingPolicy: v })}
          />
          <Select
            value={params.status}
            placeholder="状态"
            allowClear
            style={{ width: 120 }}
            options={STATUS_OPTIONS}
            onChange={(v) => updateFilter({ status: v })}
          />
          <DatePicker.RangePicker
            value={params.startDate && params.endDate ? [dayjs(params.startDate), dayjs(params.endDate)] : null}
            onChange={(dates) => {
              updateFilter({
                startDate: dates?.[0]?.toISOString(),
                endDate: dates?.[1]?.toISOString(),
              });
            }}
          />
          <Button onClick={() => setParams({ page: 1, pageSize: params.pageSize })}>重置筛选</Button>
        </Space>
        <Table
          columns={columns}
          dataSource={data?.items || []}
          rowKey="_id"
          loading={loading}
          locale={{ emptyText: error ? '加载失败，请点击重试' : undefined }}
          size="small"
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
