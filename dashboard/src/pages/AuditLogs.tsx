import { useState, useMemo } from 'react';
import {
  Table, Card, Input, Tag, Button, Drawer, Descriptions, Space, Typography, Select,
} from 'antd';
import PageHeader from '../components/PageHeader';
import { auditApi } from '../services/api';
import { useRequest } from '../hooks/useRequest';
import { describeAuditActionZh } from '../utils/audit-action-zh';

const OPERATION_KIND_LABEL: Record<string, string> = {
  create: '新增',
  update: '更新',
  delete: '删除',
  reset: '重置',
  read: '读取',
  credit: '充值',
  other: '其它',
};

const OPERATION_KIND_OPTIONS = Object.entries(OPERATION_KIND_LABEL).map(([value, label]) => ({
  value,
  label,
}));

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function AuditLogsPage() {
  const [params, setParams] = useState({
    page: 1,
    pageSize: 20,
    operationKind: undefined as string | undefined,
    action: undefined as string | undefined,
    operator: undefined as string | undefined,
    resource: undefined as string | undefined,
    result: undefined as string | undefined,
  });
  const [detailOpen, setDetailOpen] = useState(false);
  const [activeRow, setActiveRow] = useState<any>(null);

  const { data: resourceTypes = [], loading: resourceTypesLoading } = useRequest(
    () => auditApi.getResourceTypes().then((res: any) => (Array.isArray(res?.data) ? res.data : [])),
    { deps: [] },
  );

  const resourceOptions = useMemo(
    () =>
      [...resourceTypes]
        .sort((a, b) => a.localeCompare(b))
        .map((value) => ({ value, label: value })),
    [resourceTypes],
  );

  const { data, loading } = useRequest(
    () => auditApi.list(params).then((res: any) => res.data || { items: [], total: 0 }),
    {
      deps: [
        params.page,
        params.pageSize,
        params.operationKind,
        params.action,
        params.operator,
        params.resource,
        params.result,
      ],
    },
  );

  const operationKindOf = (row: any) =>
    row.operationKind || row.detail?.operationKind || 'other';

  const columns = useMemo(
    () => [
      {
        title: '时间',
        dataIndex: 'createdAt',
        width: 168,
        render: (t: string) => (t ? new Date(t).toLocaleString('zh-CN') : '-'),
      },
      {
        title: '变动类型',
        key: 'operationKind',
        width: 88,
        render: (_: unknown, row: any) => {
          const k = operationKindOf(row);
          const label = OPERATION_KIND_LABEL[k] || k;
          const color =
            k === 'delete' ? 'red' : k === 'create' ? 'green' : k === 'update' ? 'blue' : k === 'credit' ? 'cyan' : 'default';
          return <Tag color={color}>{label}</Tag>;
        },
      },
      {
        title: '操作说明',
        dataIndex: 'action',
        key: 'actionZh',
        width: 220,
        ellipsis: { showTitle: false },
        render: (raw: string) => {
          const zh = describeAuditActionZh(raw);
          return (
            <Typography.Text ellipsis={{ tooltip: `${zh}\n原始：${raw || '—'}` }} style={{ maxWidth: 208 }}>
              {zh}
            </Typography.Text>
          );
        },
      },
      {
        title: '功能/资源',
        dataIndex: 'resource',
        width: 140,
        ellipsis: true,
        render: (v: string) => (v ? <Tag>{v}</Tag> : '-'),
      },
      {
        title: '结果',
        dataIndex: 'result',
        width: 80,
        render: (v: string) =>
          (v === 'success' ? <Tag color="success">成功</Tag> : <Tag color="error">失败</Tag>),
      },
      { title: '操作人', dataIndex: 'operator', width: 120, ellipsis: true },
      {
        title: 'IP',
        dataIndex: 'ip',
        width: 140,
        ellipsis: true,
        render: (v: string, row: any) => {
          const chain = row.ipChain || row.detail?.ipChain;
          if (Array.isArray(chain) && chain.length > 1) {
            return (
              <Typography.Text ellipsis title={chain.join(' → ')}>
                {v || chain[0] || '-'}
                <span style={{ color: '#888', fontSize: 11 }}> ({chain.length} 层)</span>
              </Typography.Text>
            );
          }
          return v || '-';
        },
      },
      {
        title: '详情',
        key: 'op',
        width: 88,
        fixed: 'right' as const,
        render: (_: unknown, row: any) => (
          <Button type="link" size="small" onClick={() => { setActiveRow(row); setDetailOpen(true); }}>
            详情
          </Button>
        ),
      },
    ],
    [],
  );

  return (
    <div>
      <PageHeader
        title="审计日志"
        extra={(
          <Space wrap>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="变动类型"
              style={{ width: 140 }}
              options={OPERATION_KIND_OPTIONS}
              value={params.operationKind}
              onChange={(v) => setParams({ ...params, operationKind: v || undefined, page: 1 })}
            />
            <Select
              allowClear
              showSearch
              loading={resourceTypesLoading}
              placeholder="资源"
              style={{ width: 180 }}
              options={resourceOptions}
              value={params.resource}
              optionFilterProp="label"
              onChange={(v) => setParams({ ...params, resource: v || undefined, page: 1 })}
            />
            <Input.Search
              placeholder="操作人"
              allowClear
              style={{ width: 140 }}
              onSearch={(v) => setParams({ ...params, operator: v || undefined, page: 1 })}
            />
            <Input.Search
              placeholder="原始 action（可选）"
              allowClear
              style={{ width: 260 }}
              onSearch={(v) => setParams({ ...params, action: v || undefined, page: 1 })}
            />
            <Select
              allowClear
              placeholder="结果"
              style={{ width: 110 }}
              options={[
                { value: 'success', label: '成功' },
                { value: 'failure', label: '失败' },
              ]}
              value={params.result}
              onChange={(v) => setParams({ ...params, result: v || undefined, page: 1 })}
            />
          </Space>
        )}
      />
      <Card>
        <Table
          columns={columns}
          dataSource={data?.items || []}
          rowKey="_id"
          loading={loading}
          size="small"
          scroll={{ x: 1200 }}
          pagination={{
            current: params.page,
            pageSize: params.pageSize,
            total: data?.total || 0,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p, ps) => setParams({ ...params, page: p, pageSize: ps || 20 }),
          }}
        />
      </Card>

      <Drawer
        title="审计详情"
        width={560}
        open={detailOpen}
        onClose={() => { setDetailOpen(false); setActiveRow(null); }}
        destroyOnClose
      >
        {activeRow && (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label="操作说明">
                {describeAuditActionZh(activeRow.action)}
              </Descriptions.Item>
              <Descriptions.Item label="操作标识（原始）">
                <Typography.Text copyable>{activeRow.action || '—'}</Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="变动类型">
                {OPERATION_KIND_LABEL[operationKindOf(activeRow)] || operationKindOf(activeRow)}
              </Descriptions.Item>
              <Descriptions.Item label="资源">{activeRow.resource || '-'}</Descriptions.Item>
              <Descriptions.Item label="资源 ID">{activeRow.resourceId || '-'}</Descriptions.Item>
              <Descriptions.Item label="结果">{activeRow.result}</Descriptions.Item>
              <Descriptions.Item label="操作人">{activeRow.operator}</Descriptions.Item>
              <Descriptions.Item label="客户端 IP">{activeRow.ip || '-'}</Descriptions.Item>
              <Descriptions.Item label="代理链（层级）">
                {(activeRow.ipChain || activeRow.detail?.ipChain)?.length
                  ? (activeRow.ipChain || activeRow.detail?.ipChain).map((hop: string, i: number) => (
                    <div key={`${hop}-${i}`}>
                      <Tag style={{ marginBottom: 4 }}>
                        第 {i + 1} 跳
                      </Tag>
                      {' '}
                      {hop}
                    </div>
                  ))
                  : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="X-Forwarded-For 原文">
                {activeRow.forwardedForRaw || activeRow.detail?.forwardedForRaw || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="TCP remote">
                {activeRow.detail?.remoteAddress || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="User-Agent">
                <Typography.Paragraph ellipsis={{ rows: 3 }} style={{ marginBottom: 0 }}>
                  {activeRow.userAgent || '—'}
                </Typography.Paragraph>
              </Descriptions.Item>
              {activeRow.errorMessage && (
                <Descriptions.Item label="错误">{activeRow.errorMessage}</Descriptions.Item>
              )}
            </Descriptions>

            <Typography.Title level={5} style={{ marginTop: 8 }}>请求入参</Typography.Title>
            <Typography.Paragraph copyable>
              <pre
                style={{
                  maxHeight: 220,
                  overflow: 'auto',
                  fontSize: 12,
                  background: 'var(--ant-color-fill-quaternary)',
                  padding: 8,
                  borderRadius: 6,
                }}
              >
                {formatJson(activeRow.requestParams)}
              </pre>
            </Typography.Paragraph>

            <Typography.Title level={5}>其它详情（含响应摘要）</Typography.Title>
            <Typography.Paragraph copyable>
              <pre
                style={{
                  maxHeight: 260,
                  overflow: 'auto',
                  fontSize: 12,
                  background: 'var(--ant-color-fill-quaternary)',
                  padding: 8,
                  borderRadius: 6,
                }}
              >
                {formatJson(activeRow.detail)}
              </pre>
            </Typography.Paragraph>
          </Space>
        )}
      </Drawer>
    </div>
  );
}
