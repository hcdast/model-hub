import Table from '../components/AdminTable';
import dayjs from 'dayjs';
import { Link, useSearchParams } from 'react-router-dom';
import { useRequest } from '../hooks/useRequest';
import { useEffect, useState } from 'react';
import { Card, Form, Input, Select, Button, Space, Tag, Typography, DatePicker, Drawer } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { callbackLogApi } from '../services/api';
import { formatDateTime } from '../utils/format-helpers';
import PageHeader from '../components/PageHeader';

export default function CallbackLogsPage() {
  const [form] = Form.useForm(); const [search, setSearch] = useSearchParams();
  const [detail, setDetail] = useState<any>();
  const page = Number(search.get('page')) || 1, pageSize = Number(search.get('pageSize')) || 20;
  const params = Object.fromEntries(search);
  const { data = { items: [], total: 0 }, loading } = useRequest<any>(async () => (await callbackLogApi.list({ ...params, page, pageSize }) as any).data, { deps: [search.toString()] });
  const fetchData = (p: number, ps: number) => { const v = form.getFieldsValue(); const next: Record<string, string> = { page: String(p), pageSize: String(ps) }; for (const k of ['taskId', 'success', 'responseCode']) if (v[k] !== undefined && v[k] !== '') next[k] = v[k]; if (v.from) next.from = v.from.toISOString(); if (v.to) next.to = v.to.toISOString(); setSearch(next); };
  const columns = [
    { title: 'TaskId', dataIndex: 'taskId', width: 200, ellipsis: true, render: (id: string) => <Link to={`/tasks/${id}`}>{id}</Link> },
    { title: 'URL', dataIndex: 'callbackUrl', ellipsis: true },
    { title: '次数', dataIndex: 'attempt', width: 70 },
    {
      title: '结果',
      dataIndex: 'success',
      width: 80,
      render: (v: boolean) => (v ? <Tag color="success">成功</Tag> : <Tag color="error">失败</Tag>),
    },
    { title: 'HTTP', dataIndex: 'responseCode', width: 80, render: (v: number) => v ?? '—' },
    { title: '耗时(ms)', dataIndex: 'latencyMs', width: 90, render: (v: number) => v ?? '—' },
    { title: '错误', dataIndex: 'error', ellipsis: true, render: (v: string) => v || '—' },
    { title: '详情', render: (_: any, r: any) => <Button size="small" type="link" onClick={() => setDetail(r)}>查看响应</Button> },
    { title: '时间', dataIndex: 'createdAt', width: 170, render: (t: string) => formatDateTime(t) },
  ];

  return (
    <div>
      <PageHeader
        title="回调投递日志"
        subtitle="与任务详情中的「重放回调」配合排查；数据约保留 30 天（TTL）。"
      />
      <Card style={{ marginBottom: 16 }}>
        <Form form={form} layout="inline" initialValues={{ ...params, from: params.from ? dayjs(params.from) : undefined, to: params.to ? dayjs(params.to) : undefined }} onFinish={() => fetchData(1, pageSize)}>
          <Form.Item name="taskId" label="TaskId">
            <Input placeholder="可选" allowClear style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="success" label="结果">
            <Select allowClear placeholder="全部" style={{ width: 100 }} options={[{ value: 'true', label: '成功' }, { value: 'false', label: '失败' }]} />
          </Form.Item>
          <Form.Item name="responseCode" label="HTTP">
            <Input placeholder="如 200" allowClear style={{ width: 90 }} />
          </Form.Item>
          <Form.Item name="from" label="从">
            <DatePicker showTime style={{ width: 210 }} />
          </Form.Item>
          <Form.Item name="to" label="至">
            <DatePicker showTime style={{ width: 210 }} />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">查询</Button>
              <Button icon={<ReloadOutlined />} onClick={() => { form.setFieldsValue({ taskId: undefined, success: undefined, responseCode: undefined, from: null, to: null }); setSearch({}); }}>重置</Button>
            </Space>
          </Form.Item>
        </Form>
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
          时间按浏览器本地时区显示，查询时转换为 UTC；响应详情供排障查看。
        </Typography.Text>
      </Card>
      <Drawer title="回调投递详情" open={!!detail} onClose={() => setDetail(undefined)} width={760}><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(detail, null, 2)}</pre></Drawer>
      <Card>
        <Table
          rowKey={(r) => `${r.taskId}-${r.attempt}-${r.createdAt}`}
          columns={columns}
          dataSource={data.items}
          loading={loading}
          size="small"
          pagination={{
            current: page,
            pageSize,
            total: data.total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p, ps) => {
              fetchData(p, ps);
            },
          }}
        />
      </Card>
    </div>
  );
}
