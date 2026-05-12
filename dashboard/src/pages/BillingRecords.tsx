import { useState, useCallback } from 'react';
import { Table, Card, Input, Select, DatePicker, Button, Space, Tag, message } from 'antd';
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

/** 用量类型选项 */
const USAGE_TYPE_OPTIONS = [
  { label: 'Token', value: 'token' },
  { label: 'Count', value: 'count' },
  { label: 'Duration', value: 'duration' },
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
    'taskId', 'clientId', 'model', 'provider', 'usageType',
    'estimatedCost', 'actualCost', 'billingPolicy', 'status', 'createdAt',
  ];

  const rows = records.map((r) => [
    r.taskId,
    r.clientId,
    r.model,
    r.provider,
    r.usageType,
    String(r.estimatedCost ?? ''),
    String(r.actualCost ?? ''),
    r.billingPolicy,
    r.status,
    r.createdAt ? new Date(r.createdAt).toLocaleString('zh-CN') : '',
  ]);

  // 拼接 CSV 内容，字段用双引号包裹以处理特殊字符
  const csvContent = [
    headers.join(','),
    ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
  ].join('\n');

  // 添加 BOM 头以确保 Excel 正确识别 UTF-8 编码
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
  // 筛选参数状态
  const [params, setParams] = useState<BillingRecordQuery>({
    page: 1,
    pageSize: 20,
  });

  // 使用 useRequest 自动获取计费记录
  const { data, loading, refresh } = useRequest(
    () => billingApi.getRecords(params).then((res: any) => res.data || { items: [], total: 0 }),
    { deps: [params.page, params.pageSize, params.clientId, params.model, params.billingPolicy, params.status, params.startDate, params.endDate] },
  );

  /** 更新筛选参数并重置到第一页 */
  const updateFilter = useCallback((patch: Partial<BillingRecordQuery>) => {
    setParams((prev) => ({ ...prev, ...patch, page: 1 }));
  }, []);

  /** 表格列定义 */
  const columns = [
    {
      title: 'Task ID',
      dataIndex: 'taskId',
      key: 'taskId',
      width: 200,
      ellipsis: true,
    },
    {
      title: 'Client ID',
      dataIndex: 'clientId',
      key: 'clientId',
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
        title="计费记录"
        extra={(
          <>
            <Input.Search
              placeholder="Client ID"
              allowClear
              style={{ width: 200 }}
              onSearch={(v) => updateFilter({ clientId: v || undefined })}
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
            <Button icon={<ReloadOutlined />} onClick={refresh}>
              刷新
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
      <Card>
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
